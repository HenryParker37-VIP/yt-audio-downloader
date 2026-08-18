import cors from 'cors';
import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { YtdlpProvider } from './providers/YtdlpProvider';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Temp directory for holding downloaded MP3 files
const TEMP_DIR = path.join('/tmp', 'yt-audio-downloads');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Instantiate media provider
const mediaProvider = new YtdlpProvider();

// In-memory job store
interface DownloadJob {
  id: string;
  url: string;
  title: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  filePath?: string;
  error?: string;
  createdAt: number;
}

const jobs = new Map<string, DownloadJob>();

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST']
}));
app.use(express.json());

// SSRF / Host Validation helper
function validateYoutubeUrl(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();
    
    // Validate only allowed Youtube hostnames
    const allowedHosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be'];
    if (!allowedHosts.includes(hostname)) {
      throw new Error('Only YouTube links are supported.');
    }

    // Validate protocol
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Invalid URL protocol.');
    }

    return parsed.toString();
  } catch (err: any) {
    throw new Error(err.message || 'Invalid YouTube URL.');
  }
}

// Rate Limiters
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

const downloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // Limit each IP to 15 download requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many download requests, please try again later.' }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const isHealthy = await mediaProvider.healthCheck();
  if (isHealthy) {
    res.json({ status: 'healthy', provider: 'yt-dlp' });
  } else {
    res.status(500).json({ status: 'unhealthy', provider: 'yt-dlp (not available)' });
  }
});

// Fetch Metadata route
app.post('/api/info', apiLimiter, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required.' });
    }

    const validatedUrl = validateYoutubeUrl(url);
    const metadata = await mediaProvider.getMetadata(validatedUrl);

    // Limit video duration to 15 minutes (900 seconds) to prevent server abuse
    const MAX_DURATION_SEC = 900;
    if (metadata.duration > MAX_DURATION_SEC) {
      return res.status(400).json({
        error: `Video is too long (${Math.round(metadata.duration / 60)}m). Max duration allowed is ${MAX_DURATION_SEC / 60} minutes.`
      });
    }

    res.json(metadata);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to retrieve video metadata.' });
  }
});

// Trigger Download/Conversion Job
app.post('/api/download', downloadLimiter, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required.' });
    }

    const validatedUrl = validateYoutubeUrl(url);

    // Fetch metadata first to ensure validity and duration constraints
    const metadata = await mediaProvider.getMetadata(validatedUrl);
    const MAX_DURATION_SEC = 900;
    if (metadata.duration > MAX_DURATION_SEC) {
      return res.status(400).json({
        error: `Video is too long (${Math.round(metadata.duration / 60)}m). Max duration is ${MAX_DURATION_SEC / 60} minutes.`
      });
    }

    // Generate unique ID and temp file path
    const jobId = crypto.randomUUID();
    const safeFilename = `${jobId}.mp3`;
    const outputPath = path.join(TEMP_DIR, safeFilename);

    const job: DownloadJob = {
      id: jobId,
      url: validatedUrl,
      title: metadata.title,
      status: 'downloading',
      filePath: outputPath,
      createdAt: Date.now()
    };

    jobs.set(jobId, job);

    // Run the download process asynchronously
    mediaProvider.downloadAudio(validatedUrl, outputPath)
      .then(() => {
        const currentJob = jobs.get(jobId);
        if (currentJob) {
          currentJob.status = 'completed';
          jobs.set(jobId, currentJob);
        }
      })
      .catch((err) => {
        console.error(`Download failed for job ${jobId}:`, err);
        const currentJob = jobs.get(jobId);
        if (currentJob) {
          currentJob.status = 'failed';
          currentJob.error = err.message || 'Extraction failed';
          jobs.set(jobId, currentJob);
        }
        // Cleanup file if it exists
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
      });

    res.status(202).json({ jobId, title: metadata.title, status: 'downloading' });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to start download.' });
  }
});

// Check Job Status
app.get('/api/jobs/:id', apiLimiter, (req, res) => {
  const jobId = req.params.id;
  const job = jobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  res.json({
    id: job.id,
    title: job.title,
    status: job.status,
    error: job.error
  });
});

// Download resulting file
app.get('/api/jobs/:id/download', async (req, res) => {
  const jobId = req.params.id;
  const job = jobs.get(jobId);

  if (!job || job.status !== 'completed' || !job.filePath || !fs.existsSync(job.filePath)) {
    return res.status(404).json({ error: 'Audio file not ready or not found.' });
  }

  const { filePath, title } = job;

  // Clean filename: remove special characters, limit length, fall back to "audio"
  let cleanTitle = title
    .replace(/[\\/:*?"<>|]/g, '') // remove forbidden filename chars
    .trim()
    .substring(0, 100);
  if (!cleanTitle) cleanTitle = 'audio';

  const userFilename = `${cleanTitle}.mp3`;
  const encodedFilename = encodeURIComponent(userFilename);

  // Set response headers for secure, native download behavior
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Disposition', `attachment; filename="${userFilename}"; filename*=UTF-8''${encodedFilename}`);

  const stat = fs.statSync(filePath);
  res.setHeader('Content-Length', stat.size);

  // Stream file to response
  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);

  fileStream.on('end', () => {
    // Delete temp file and remove job from memory immediately after sending
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      jobs.delete(jobId);
    } catch (err) {
      console.error(`Failed to clean up job file ${filePath}:`, err);
    }
  });

  fileStream.on('error', (err) => {
    console.error(`Stream error during download of job ${jobId}:`, err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to stream download.' });
    }
  });
});

// Serve frontend build if it exists
const frontendDistPath = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

// Background cleanup: every 2 minutes, delete files and jobs older than 10 minutes
setInterval(() => {
  const now = Date.now();
  const TEN_MINUTES = 10 * 60 * 1000;

  for (const [id, job] of jobs.entries()) {
    if (now - job.createdAt > TEN_MINUTES) {
      try {
        if (job.filePath && fs.existsSync(job.filePath)) {
          fs.unlinkSync(job.filePath);
        }
      } catch (err) {
        console.error(`Scheduled cleanup failed for ${job.filePath}:`, err);
      }
      jobs.delete(id);
    }
  }
}, 120000);

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Temp downloads directory: ${TEMP_DIR}`);
});
