FROM node:18

# Install ffmpeg
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Bundle app source
COPY . .

# Create music directory
RUN mkdir -p music

# Expose ports
EXPOSE 3000

# Start the application
CMD [ "npm", "start" ] 