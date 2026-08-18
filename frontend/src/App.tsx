import { useState, useEffect, useRef } from 'react';
import type { ClipboardEvent } from 'react';

interface MediaMetadata {
  title: string;
  duration: number;
  thumbnail: string;
  url: string;
}

type AppState = 'idle' | 'fetching-metadata' | 'metadata-ready' | 'downloading' | 'success' | 'error';

export default function App() {
  const [url, setUrl] = useState('');
  const [state, setState] = useState<AppState>('idle');
  const [metadata, setMetadata] = useState<MediaMetadata | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobProgressText, setJobProgressText] = useState('Preparing download...');
  const [error, setError] = useState<string | null>(null);

  const lastFetchedUrl = useRef<string | null>(null);
  const pollIntervalRef = useRef<number | null>(null);

  // Parse duration in seconds to HH:MM:SS or MM:SS
  const formatDuration = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const pad = (num: number) => String(num).padStart(2, '0');

    if (hrs > 0) {
      return `${hrs}:${pad(mins)}:${pad(secs)}`;
    }
    return `${mins}:${pad(secs)}`;
  };

  // Helper to validate YouTube URL format on client side
  const isValidYoutubeUrl = (input: string): boolean => {
    try {
      const parsed = new URL(input);
      const host = parsed.hostname.toLowerCase();
      return ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be'].includes(host);
    } catch {
      return false;
    }
  };

  // Fetch video metadata from backend
  const fetchMetadata = async (targetUrl: string) => {
    if (!targetUrl || lastFetchedUrl.current === targetUrl) return;

    setError(null);
    setState('fetching-metadata');
    lastFetchedUrl.current = targetUrl;

    try {
      const res = await fetch('/api/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch video details.');
      }

      setMetadata(data);
      setState('metadata-ready');
    } catch (err: any) {
      setError(err.message || 'An error occurred while fetching video details.');
      setState('error');
      lastFetchedUrl.current = null; // allow retrying the same URL
    }
  };

  // Detect URL paste/changes and auto-trigger metadata lookup
  useEffect(() => {
    const trimmed = url.trim();
    if (trimmed && isValidYoutubeUrl(trimmed)) {
      fetchMetadata(trimmed);
    } else if (!trimmed) {
      setState('idle');
      setMetadata(null);
      setError(null);
      lastFetchedUrl.current = null;
    }
  }, [url]);

  // Handle manual paste to improve responsive speed
  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pastedText = e.clipboardData.getData('text');
    const trimmed = pastedText.trim();
    if (trimmed && isValidYoutubeUrl(trimmed)) {
      setUrl(trimmed);
      fetchMetadata(trimmed);
    }
  };

  // Start the conversion and download flow
  const handleStartDownload = async () => {
    if (!metadata) return;

    setError(null);
    setState('downloading');
    setJobProgressText('Connecting to extraction server...');

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: metadata.url }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to initialize download.');
      }

      setJobId(data.jobId);
      setJobProgressText('Downloading audio stream...');
      startPolling(data.jobId);
    } catch (err: any) {
      setError(err.message || 'Failed to start download.');
      setState('error');
    }
  };

  // Poll background job status
  const startPolling = (id: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    pollIntervalRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${id}`);
        if (!res.ok) {
          throw new Error('Failed to get job status.');
        }

        const data = await res.json();

        if (data.status === 'downloading') {
          setJobProgressText('Downloading audio from YouTube...');
        } else if (data.status === 'completed') {
          stopPolling();
          setState('success');
        } else if (data.status === 'failed') {
          stopPolling();
          throw new Error(data.error || 'Audio conversion failed.');
        }
      } catch (err: any) {
        stopPolling();
        setError(err.message || 'Error processing audio.');
        setState('error');
      }
    }, 1500);
  };

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  // Trigger actual file download
  const triggerFileDownload = () => {
    if (!jobId) return;
    // Redirect to the download endpoint which triggers browser download and cleans up
    window.location.href = `/api/jobs/${jobId}/download`;
  };

  // Clear/reset state to download another audio
  const handleReset = () => {
    stopPolling();
    setUrl('');
    setMetadata(null);
    setJobId(null);
    setError(null);
    lastFetchedUrl.current = null;
    setState('idle');
  };

  // Cleanup timers on unmount
  useEffect(() => {
    return () => stopPolling();
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 md:p-8 selection:bg-accent/20">
      
      {/* Decorative Blur Spheres (very subtle glass feeling) */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full bg-accent/5 blur-3xl pointer-events-none" />

      <main className="w-full max-w-md z-10">
        
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-accent/10 text-accent mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Download audio</h1>
          <p className="text-sm opacity-60 mt-1.5">Paste a YouTube link and save the audio as MP3.</p>
        </div>

        {/* Core Glass Card */}
        <div className="glass-panel rounded-2xl shadow-sm p-6 relative overflow-hidden transition-all duration-300 ease-out">
          
          {/* Main Form Fields */}
          {state !== 'success' && state !== 'downloading' && (
            <div className="space-y-4">
              <div className="relative">
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onPaste={handlePaste}
                  placeholder="Paste YouTube link here..."
                  className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-black/20 focus:bg-white dark:focus:bg-black/40 focus:border-accent focus:ring-1 focus:ring-accent outline-none text-sm transition-all placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
                  disabled={state === 'fetching-metadata'}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                />
                
                {state === 'fetching-metadata' && (
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                    <svg className="animate-spin h-4 w-4 text-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Metadata Display / Preview */}
          {metadata && state !== 'success' && (
            <div className="mt-5 p-4 rounded-xl bg-white/20 dark:bg-black/10 border border-white/30 dark:border-white/5 flex gap-4 transition-all duration-300 animate-fadeIn">
              <img
                src={metadata.thumbnail}
                alt={metadata.title}
                className="w-24 h-16 object-cover rounded-lg bg-zinc-200 dark:bg-zinc-800 shrink-0"
              />
              <div className="flex flex-col justify-center min-w-0">
                <h4 className="text-sm font-medium leading-tight truncate-two-lines dark:text-zinc-100">
                  {metadata.title}
                </h4>
                <span className="text-xs opacity-50 mt-1">
                  Duration: {formatDuration(metadata.duration)}
                </span>
              </div>
            </div>
          )}

          {/* Action Buttons & Status Areas */}
          <div className="mt-5">
            {state === 'metadata-ready' && (
              <button
                onClick={handleStartDownload}
                className="w-full bg-accent hover:bg-accent-hover text-white text-sm font-medium py-3 rounded-xl transition-all active:scale-[0.98] cursor-pointer shadow-sm hover:shadow-md -webkit-tap-highlight-color-transparent"
              >
                Download MP3
              </button>
            )}

            {state === 'downloading' && (
              <div className="text-center py-6 space-y-4">
                <div className="inline-block relative">
                  <svg className="animate-spin h-8 w-8 text-accent mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{jobProgressText}</p>
                  <p className="text-xs opacity-50">Please do not close this window</p>
                </div>
              </div>
            )}

            {state === 'success' && (
              <div className="text-center py-6 space-y-5 animate-scaleUp">
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-500 mx-auto flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-6 h-6">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                </div>
                
                <div className="space-y-1 px-2">
                  <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Ready to save</h3>
                  <p className="text-xs opacity-60 truncate px-4">{metadata?.title}</p>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={triggerFileDownload}
                    className="w-full bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium py-3 rounded-xl transition-all active:scale-[0.98] cursor-pointer shadow-sm hover:shadow-md"
                  >
                    Save MP3 File
                  </button>
                  <button
                    onClick={handleReset}
                    className="w-full border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-sm font-medium py-2.5 rounded-xl transition-all active:scale-[0.98] cursor-pointer"
                  >
                    Convert Another
                  </button>
                </div>
              </div>
            )}

            {/* Custom Inline Error View */}
            {state === 'error' && error && (
              <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/10 text-center animate-fadeIn">
                <div className="w-8 h-8 rounded-full bg-red-500/10 text-red-500 mx-auto flex items-center justify-center mb-2">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                  </svg>
                </div>
                <p className="text-xs text-red-600 dark:text-red-400 font-medium px-2 leading-relaxed">{error}</p>
                <button
                  onClick={handleReset}
                  className="mt-3.5 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 font-medium underline underline-offset-4"
                >
                  Try again
                </button>
              </div>
            )}
          </div>

        </div>

        {/* Subtle Footer info */}
        <p className="text-[10px] text-center opacity-30 mt-6 select-none font-mono">
          Phase 1 • High Quality Audio Extraction
        </p>

      </main>
    </div>
  );
}
