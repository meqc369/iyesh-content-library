FROM node:22-alpine

WORKDIR /app
COPY server/package.json ./
COPY server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/index.mjs server/import-content.mjs server/smoke.mjs server/production-smoke.mjs ./
COPY server/import.example.json ./

ENV NODE_ENV=production
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok) process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "index.mjs"]
