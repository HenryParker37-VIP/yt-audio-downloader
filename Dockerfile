# --- Base Image with Dependencies ---
FROM node:20-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci

# --- Build Frontend ---
FROM base AS frontend-builder
COPY frontend/ ./frontend/
RUN npm run build -w frontend

# --- Build Backend ---
FROM base AS backend-builder
COPY backend/ ./backend/
RUN npm run build -w backend

# --- Production Image ---
FROM node:20-slim AS runner

# Install system dependencies: python3 (for yt-dlp), ffmpeg (for conversion), curl (for fetching yt-dlp)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 ffmpeg curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Download and install the latest yt-dlp binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Copy root configurations and production dependencies only
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
RUN npm ci --omit=dev

# Copy compiled frontend and backend outputs
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
COPY --from=backend-builder /app/backend/dist ./backend/dist

# Configure runtime environments
ENV PORT=3001
ENV NODE_ENV=production
ENV YT_DLP_PATH=/usr/local/bin/yt-dlp

EXPOSE 3001

CMD ["npm", "start", "-w", "backend"]
