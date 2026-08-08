FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY apps/api/pyproject.toml ./pyproject.toml
RUN python -c "import tomllib; data = tomllib.load(open('pyproject.toml', 'rb')); print('\\n'.join(data['project']['dependencies']))" > /tmp/requirements.txt \
    && sed -i 's|^arq==0.26.3$|arq @ https://files.pythonhosted.org/packages/85/b3/a24a183c628da633b7cafd1759b14aaf47958de82ba6bcae9f1c2898781d/arq-0.26.3-py3-none-any.whl|' /tmp/requirements.txt \
    && pip install -r /tmp/requirements.txt
COPY apps/api/app ./app
RUN pip install --no-deps .
COPY apps/api/alembic.ini ./alembic.ini
COPY apps/api/alembic ./alembic
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
