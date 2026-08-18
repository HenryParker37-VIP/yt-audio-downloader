export interface MediaMetadata {
  title: string;
  duration: number; // in seconds
  thumbnail: string;
  url: string;
}

export interface MediaProvider {
  getMetadata(url: string): Promise<MediaMetadata>;
  downloadAudio(url: string, outputPath: string): Promise<void>;
  healthCheck(): Promise<boolean>;
}
