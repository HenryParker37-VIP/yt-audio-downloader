import { spawn } from 'child_process';
import { MediaMetadata, MediaProvider } from './MediaProvider';

export class YtdlpProvider implements MediaProvider {
  private ytDlpPath: string;

  constructor() {
    // Default to 'yt-dlp' or env config
    this.ytDlpPath = process.env.YT_DLP_PATH || 'yt-dlp';
  }

  async getMetadata(url: string): Promise<MediaMetadata> {
    return new Promise((resolve, reject) => {
      // Set a 15-second timeout for fetching metadata
      const timeoutMs = 15000;
      const child = spawn(this.ytDlpPath, [
        '--no-playlist',
        '--dump-json',
        '--skip-download',
        url
      ]);

      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Metadata retrieval timed out'));
      }, timeoutMs);

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`yt-dlp exited with code ${code}. Error: ${stderr.trim() || 'Unknown error'}`));
          return;
        }

        try {
          const parsed = JSON.parse(stdout);
          resolve({
            title: parsed.title || 'Unknown Title',
            duration: parsed.duration || 0,
            thumbnail: parsed.thumbnail || parsed.thumbnails?.[0]?.url || '',
            url: parsed.webpage_url || url
          });
        } catch (err) {
          reject(new Error('Failed to parse metadata from yt-dlp output'));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Failed to start yt-dlp: ${err.message}`));
      });
    });
  }

  async downloadAudio(url: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Set a 3-minute timeout for downloads to prevent hanging resources
      const timeoutMs = 180000;
      
      // -o outputPath specifies the exact target file path.
      // -x extracts audio.
      // --audio-format mp3 specifies the format.
      // --audio-quality 0 specifies the best VBR quality (approx 256-320 kbps).
      const child = spawn(this.ytDlpPath, [
        '--no-playlist',
        '-x',
        '--audio-format',
        'mp3',
        '--audio-quality',
        '0',
        '-o',
        outputPath,
        url
      ]);

      let stderr = '';

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Audio download/conversion timed out'));
      }, timeoutMs);

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`yt-dlp download exited with code ${code}. Error: ${stderr.trim() || 'Unknown error'}`));
          return;
        }
        resolve();
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Failed to start download process: ${err.message}`));
      });
    });
  }

  async healthCheck(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(this.ytDlpPath, ['--version']);
      child.on('close', (code) => {
        resolve(code === 0);
      });
      child.on('error', () => {
        resolve(false);
      });
    });
  }
}
