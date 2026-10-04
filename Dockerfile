FROM node:18-alpine

WORKDIR /app

# Skopiowanie plików konfiguracyjnych i instalacja zależności
COPY package*.json ./
RUN npm install

# Skopiowanie reszty kodu aplikacji
COPY . .

# Zastąp 3000 portem, na którym nasłuchuje Twoja aplikacja (jeśli jest inny)
EXPOSE 3000

CMD ["npm", "start"]