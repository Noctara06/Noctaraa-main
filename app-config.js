window.MIDNIGHT_CONFIG = window.MIDNIGHT_CONFIG || window.AUDIO_HUB_CONFIG || {
  // Local development: the bundled backend runs on this address.
  // Before deploying the frontend separately, replace this with your hosted API
  // URL, e.g. https://your-backend-domain.com/api/v1.
  apiBase: "https://noctaraa-main.onrender.com/api/v1"
};

window.AUDIO_HUB_CONFIG = window.AUDIO_HUB_CONFIG || window.MIDNIGHT_CONFIG;
