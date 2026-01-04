FROM node:24-slim

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# Vite port
EXPOSE 5175

CMD ["npm", "run", "dev"]
