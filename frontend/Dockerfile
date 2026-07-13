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

# Expose the port used by the frontend (default 8080)
EXPOSE 8080

# Set environment variables for Cloud Run
ENV NODE_ENV=production

# Run the application
CMD ["node", "server.js"]