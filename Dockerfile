# --- build stage: Vite production build ---
# Debian (glibc) base on purpose: package.json pins @rollup/rollup-linux-x64-gnu,
# which won't load on Alpine/musl.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --legacy-peer-deps: repo has a known React 19 vs react-datasheet-grid peer conflict
RUN npm install --legacy-peer-deps
COPY . .
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_CLOUD_API_ENDPOINT
ARG VITE_BASE_PATH=/
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID \
    VITE_CLOUD_API_ENDPOINT=$VITE_CLOUD_API_ENDPOINT \
    VITE_BASE_PATH=$VITE_BASE_PATH
RUN npm run build

# --- runtime stage: static files via nginx ---
FROM nginx:alpine AS runtime
COPY deploy-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
