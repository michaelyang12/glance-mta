# Build stage - using Bun to build the frontend
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source and build
COPY . .
RUN bun run build

# Runtime stage - serve with nginx and run Tailscale
FROM nginx:alpine

# Install dependencies for Tailscale
RUN apk add --no-cache tailscale iproute2 iptables curl openresolv

# Copy built frontend files from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose HTTP port
EXPOSE 80

# Start Tailscale, nginx and wait for tailscaled to be ready
CMD tailscaled --state=/tailscale/tailscaled.state & \
    tailscale up --authkey=$TAILSCALE_AUTHKEY --hostname=$TAILSCALE_HOSTNAME --accept-routes=true && \
    tailscale funnel --bg 80 && \
    nginx -g 'daemon off;'
