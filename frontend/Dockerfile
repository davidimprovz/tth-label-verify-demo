# syntax=docker/dockerfile:1
FROM node:20-slim

WORKDIR /app

# Install dependencies inside the image. Copy only the manifest first so this
# layer caches across source changes.
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the source. The dev bind mount in docker-compose overlays
# this at runtime; node_modules stays in the image (see .dockerignore).
COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev"]
