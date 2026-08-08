FROM python:3.12-slim

WORKDIR /service
COPY mcp_servers/baidu/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY mcp_servers/baidu ./mcp_servers/baidu
ENV PYTHONPATH=/service
EXPOSE 8100
CMD ["python", "-m", "mcp_servers.baidu.server"]
