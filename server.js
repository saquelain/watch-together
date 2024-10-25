import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import multer from 'multer';
import fs from 'fs';
import { networkInterfaces } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",  // Be careful with this in production
        methods: ["GET", "POST"]
    }
});

// Configure multer for video upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = join(__dirname, 'public', 'uploads');
        // Create uploads directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${req.body.roomId}-${Date.now()}`;
        cb(null, `video-${uniqueSuffix}${file.originalname.substring(file.originalname.lastIndexOf('.'))}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 500 * 1024 * 1024, // 500MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else {
            cb(new Error('Only video files are allowed!'));
        }
    }
});

// Serve static files
app.use(express.static('public'));
app.use('/uploads', express.static(join(__dirname, 'public', 'uploads')));

// Store room data
const rooms = new Map();

app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.get('/room/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            users: new Set(),
            currentTime: 0,
            isPlaying: false,
            currentVideo: null
        });
    }
    res.sendFile(join(__dirname, 'public', 'room.html'));
});

// Handle video upload
app.post('/upload-video', upload.single('video'), (req, res) => {
    try {
        if (!req.file) {
            throw new Error('No file uploaded');
        }

        const roomId = req.body.roomId;
        const videoUrl = `/uploads/${req.file.filename}`;

        // Update room data with new video
        const room = rooms.get(roomId);
        if (room) {
            // Clean up old video if it exists
            if (room.currentVideo) {
                const oldVideoPath = join(__dirname, 'public', room.currentVideo);
                try {
                    if (fs.existsSync(oldVideoPath)) {
                        fs.unlinkSync(oldVideoPath);
                    }
                } catch (err) {
                    console.error('Error deleting old video:', err);
                }
            }
            room.currentVideo = videoUrl;
            
            // Notify all users in the room about the new video
            io.to(roomId).emit('videoChange', { videoUrl });
        }

        res.json({ videoUrl });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

io.on('connection', (socket) => {
    let currentRoom;

    socket.on('joinRoom', (roomId) => {
        console.log(`User ${socket.id} joined room ${roomId}`);
        currentRoom = roomId;
        socket.join(roomId);
        const room = rooms.get(roomId);
        room.users.add(socket.id);
        
        console.log('Sending sync data:', {
            currentTime: room.currentTime,
            isPlaying: room.isPlaying,
            currentVideo: room.currentVideo
        });
        
        socket.emit('syncVideo', {
            currentTime: room.currentTime,
            isPlaying: room.isPlaying,
            currentVideo: room.currentVideo
        });
    });

    socket.on('play', (roomId) => {
        const room = rooms.get(roomId);
        room.isPlaying = true;
        socket.to(roomId).emit('play');
    });

    socket.on('pause', (roomId) => {
        const room = rooms.get(roomId);
        room.isPlaying = false;
        socket.to(roomId).emit('pause');
    });

    socket.on('seeked', ({ roomId, currentTime }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.currentTime = currentTime;
            // Broadcast to other users only
            socket.to(roomId).emit('seek', currentTime);
        }
    });

    socket.on('checkSync', ({ roomId, currentTime, isPlaying }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.currentTime = currentTime;
            room.isPlaying = isPlaying;
            // Send sync response to other clients
            socket.to(roomId).emit('syncResponse', {
                hostTime: currentTime,
                isPlaying
            });
        }
    });

    socket.on('disconnect', () => {
        if (currentRoom) {
            const room = rooms.get(currentRoom);
            console.log('room: ', room);
            if (room) {
                room.users.delete(socket.id);
                if (room.users.size === 0) {
                    // Clean up video file when room is empty
                    if (room.currentVideo) {
                        const videoPath = join(__dirname, 'public', room.currentVideo);
                        if (fs.existsSync(videoPath)) {
                            fs.unlinkSync(videoPath);
                        }
                    }
                    rooms.delete(currentRoom);
                }
            }
        }
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                error: 'File is too large. Maximum size is 500MB'
            });
        }
    }
    res.status(500).json({
        error: error.message
    });
});

// Function to get local IP address
function getLocalIp() {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            // Skip internal and non-IPv4 addresses
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return '0.0.0.0';
}

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
    const localIp = getLocalIp();
    console.log('\n=================================');
    console.log(`Server running on port ${PORT}`);
    console.log('Access URLs:');
    console.log(`Local: http://localhost:${PORT}`);
    console.log(`Network: http://${localIp}:${PORT}`);
    console.log('=================================\n');
});