import axios from 'axios';

// Default to Vite proxy in development (/api -> localhost:5000).
// In production, set VITE_API_BASE_URL to a full API URL if needed.
const baseURL = import.meta.env.VITE_API_BASE_URL || '/api';

const api = axios.create({
  baseURL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;
