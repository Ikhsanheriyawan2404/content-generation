# Base image
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files terlebih dahulu (agar cache lebih efisien)
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy seluruh source code
COPY . .

# Build TypeScript
RUN npm run build

# ---- Production Stage ----
FROM node:20-alpine

WORKDIR /app

# Copy hanya file hasil build + dependencies + prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist
COPY package*.json ./

# Jalankan aplikasi
CMD ["node", "dist/server.js"]
