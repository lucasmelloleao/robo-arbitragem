# Use Node.js LTS
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies (production only)
RUN npm ci --only=production

# Copy source code
COPY . .

# Expose the port used by the arbitrage server (default 8081)
EXPOSE 8081

# Set environment variables for Cloud Run
ENV NODE_ENV=production
ENV STRATEGY=arbitrage
ENV PORT_ARBITRAGE=8081

# Run the application
CMD ["node", "index.js"]