FROM python:3.12-slim

WORKDIR /service
RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*
COPY mcp_servers/xhs/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY mcp_servers/xhs ./mcp_servers/xhs
ENV PYTHONPATH=/service
EXPOSE 8200
CMD ["python", "-m", "mcp_servers.xhs.server"]
