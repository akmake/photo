import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import connectDB from './config/db.js';
import globalErrorHandler from './middlewares/errorMiddleware.js';
import AppError from './utils/AppError.js';

dotenv.config();

const app = express();

connectDB();

app.use(cors({
  origin: ['http://localhost:5173'],
  credentials: true
}));

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

app.use(globalErrorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
