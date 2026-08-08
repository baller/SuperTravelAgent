FROM python:3.12-slim

WORKDIR /service
RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs npm \
    && npm install --global 12306-mcp@0.3.9 \
    && rm -rf /var/lib/apt/lists/*
COPY mcp_servers/rail/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY mcp_servers/rail ./mcp_servers/rail

CMD ["python", "-m", "mcp_servers.rail.server"]
EXPOSE 8000
