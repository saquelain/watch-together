$(document).ready(function () {
    let isSeekingLocally = false;
    const socket = io();
    const roomId = window.location.pathname.split("/").pop();
    const video = document.getElementById("videoPlayer");
    const videoInput = document.getElementById("videoInput");
    const loadingOverlay = document.getElementById("loadingOverlay");
    const shareButton = document.getElementById("shareButton");
    const copyButton = document.getElementById("copyButton");
    const shareModal = new bootstrap.Modal(document.getElementById('shareModal'));

    // Initialize room
    document.getElementById("roomUrl").value = window.location.href;
    document.getElementById("roomIdDisplay").textContent = roomId;
    socket.emit("joinRoom", roomId);

    // Share functionality
    shareButton.addEventListener("click", () => {
        if (navigator.share) {
            // Use native sharing on mobile devices
            navigator.share({
                title: 'Watch Together Room',
                url: window.location.href
            }).catch(console.error);
        } else {
            // Fall back to modal for desktop
            shareModal.show();
        }
    });

    // Copy room URL
    copyButton.addEventListener("click", () => {
        const roomUrl = document.getElementById("roomUrl");
        roomUrl.select();
        document.execCommand("copy");
        
        // Show toast notification
        showToast("Room URL copied to clipboard!");
    });

    // Video upload handling
    videoInput.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Show loading overlay
        loadingOverlay.classList.remove("d-none");

        try {
            const formData = new FormData();
            formData.append("video", file);
            formData.append("roomId", roomId);

            const response = await fetch("/upload-video", {
                method: "POST",
                body: formData,
            });

            if (!response.ok) {
                throw new Error("Upload failed");
            }

            const { videoUrl } = await response.json();
            video.src = videoUrl;
        } catch (error) {
            showToast("Failed to upload video: " + error.message, "error");
        } finally {
            loadingOverlay.classList.add("d-none");
        }
    });

    // Video player event handlers
    video.addEventListener("play", () => {
        socket.emit("play", roomId);
    });

    video.addEventListener("pause", () => {
        socket.emit("pause", roomId);
    });

    video.addEventListener("seeked", () => {
        if (isSeekingLocally) {
            socket.emit("seeked", {
                roomId,
                currentTime: video.currentTime,
            });
            isSeekingLocally = false;
        }
    });

    video.addEventListener("seeking", () => {
        isSeekingLocally = true;
    });

    // Socket event handlers
    socket.on("videoChange", (data) => {
        if (data.videoUrl) {
            video.src = data.videoUrl;
            video.load();
        }
    });

    socket.on("play", () => video.play());
    socket.on("pause", () => video.pause());
    socket.on("seek", (currentTime) => {
        if (Math.abs(video.currentTime - currentTime) > 0.5) {
            video.currentTime = currentTime;
        }
    });

    socket.on("syncVideo", ({ currentTime, isPlaying, currentVideo }) => {
        if (currentVideo && video.src !== currentVideo) {
            video.src = currentVideo;
        }
        video.currentTime = currentTime;
        video.muted = true;
        
        if (isPlaying) {
            video.play().catch(console.error);
        } else {
            video.pause();
        }
    });

    // Error handling
    video.addEventListener("error", () => {
        showToast("Error loading video. Please try refreshing the page.", "error");
    });

    socket.on("connect_error", () => {
        showToast("Connection error. Please check your internet connection.", "error");
    });

    // Helper function to show toast notifications
    function showToast(message, type = "info") {
        const toastContainer = document.querySelector(".toast-container") || 
            (() => {
                const container = document.createElement("div");
                container.className = "toast-container";
                document.body.appendChild(container);
                return container;
            })();

        const toast = document.createElement("div");
        toast.className = `toast align-items-center text-white bg-${type === "error" ? "danger" : "primary"} border-0`;
        toast.setAttribute("role", "alert");
        toast.innerHTML = `
            <div class="d-flex">
                <div class="toast-body">${message}</div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
            </div>
        `;

        toastContainer.appendChild(toast);
        const bsToast = new bootstrap.Toast(toast);
        bsToast.show();

        toast.addEventListener('hidden.bs.toast', () => {
            toast.remove();
        });
    }

    // Handle fullscreen for mobile
    const videoContainer = document.querySelector('.video-container');
    videoContainer.addEventListener('dblclick', () => {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            videoContainer.requestFullscreen().catch(console.error);
        }
    });
});