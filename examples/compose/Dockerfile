FROM node:24-alpine
ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
ENV BIND_HOST=0.0.0.0
RUN npm install -g fhirhydrant
# This example ships a minimal resource catalog. Wipe the packaged resources/
# folder first so only the two resources below are exposed (additive COPY alone
# would leave all default resource files in place).
RUN rm -rf /usr/local/lib/node_modules/fhirhydrant/config/resources
COPY config/ /usr/local/lib/node_modules/fhirhydrant/config/
USER node
EXPOSE 5000
HEALTHCHECK CMD wget -qO- http://127.0.0.1:5000/health || exit 1
CMD ["fhirhydrant"]
