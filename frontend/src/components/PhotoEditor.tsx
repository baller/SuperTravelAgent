import React, { useState, useEffect } from 'react';
import { 
  Card, 
  Button, 
  message, 
  Space, 
  Typography, 
  Alert,
  Spin
} from 'antd';
import { 
  PictureOutlined, 
  ReloadOutlined
} from '@ant-design/icons';

const { Text, Title } = Typography;

interface PhotoEditorProps {
  style?: React.CSSProperties;
}

const PhotoEditor: React.FC<PhotoEditorProps> = ({ style }) => {
  const [serviceStatus, setServiceStatus] = useState<'loading' | 'connected' | 'disconnected'>('loading');
  const [iframeLoading, setIframeLoading] = useState<boolean>(true);
  
  const POWERPAINT_URL = 'http://localhost:7860';

  // 检查PowerPaint服务状态
  const checkServiceStatus = async () => {
    try {
      const response = await fetch(POWERPAINT_URL, { 
        method: 'GET',
        mode: 'no-cors' // 避免CORS问题
      });
      setServiceStatus('connected');
    } catch (error) {
      console.error('PowerPaint服务检查失败:', error);
      setServiceStatus('disconnected');
    }
  };

  // 组件加载时检查服务状态
  useEffect(() => {
    checkServiceStatus();
    // 每30秒检查一次服务状态
    const interval = setInterval(checkServiceStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // 刷新iframe
  const refreshIframe = () => {
    setIframeLoading(true);
    const iframe = document.getElementById('powerpaint-iframe') as HTMLIFrameElement;
    if (iframe) {
      iframe.src = iframe.src;
    }
  };

  // iframe加载完成
  const handleIframeLoad = () => {
    setIframeLoading(false);
    if (serviceStatus !== 'connected') {
      setServiceStatus('connected');
    }
  };

  // iframe加载错误
  const handleIframeError = () => {
    setIframeLoading(false);
    setServiceStatus('disconnected');
  };

  const getStatusColor = () => {
    switch (serviceStatus) {
      case 'connected': return '#52c41a';
      case 'disconnected': return '#ff4d4f';
      default: return '#faad14';
    }
  };

  const getStatusText = () => {
    switch (serviceStatus) {
      case 'connected': return 'PowerPaint 服务已连接';
      case 'disconnected': return 'PowerPaint 服务未连接';
      default: return '检查服务状态中...';
    }
  };

  return (
    <Card 
      title={
        <Space>
          <PictureOutlined />
          <Title level={4} style={{ margin: 0 }}>PowerPaint 图片编辑</Title>
          <span 
            style={{ 
              color: getStatusColor(), 
              fontSize: '12px',
              marginLeft: '16px'
            }}
          >
            ● {getStatusText()}
          </span>
        </Space>
      }
      style={style}
      bodyStyle={{ padding: '16px' }}
      extra={
        <Button 
          icon={<ReloadOutlined />} 
          onClick={refreshIframe}
          size="small"
          disabled={serviceStatus === 'disconnected'}
        >
          刷新
        </Button>
      }
    >
      {serviceStatus === 'disconnected' ? (
        <Alert
          message="PowerPaint 服务未运行"
          description={
            <div>
              <p>请确保 PowerPaint 服务正在 localhost:7860 端口运行。</p>
              <p>如果您还没有启动 PowerPaint，请运行以下命令：</p>
              <code style={{ 
                display: 'block', 
                background: '#f5f5f5', 
                padding: '8px', 
                borderRadius: '4px',
                marginTop: '8px'
              }}>
                cd /home/user_3/Advanced_AI_Course/PowerPaint && python app.py
              </code>
              <Button 
                type="link" 
                onClick={checkServiceStatus}
                style={{ paddingLeft: 0, marginTop: '8px' }}
              >
                重新检查服务状态
              </Button>
            </div>
          }
          type="warning"
          showIcon
        />
      ) : (
        <div style={{ position: 'relative', height: '80vh', minHeight: '600px' }}>
          {iframeLoading && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255, 255, 255, 0.9)',
              zIndex: 10
            }}>
              <Spin size="large" />
              <Text style={{ marginTop: '16px' }}>正在加载 PowerPaint 界面...</Text>
            </div>
          )}
          
          <iframe
            id="powerpaint-iframe"
            src={POWERPAINT_URL}
            style={{
              width: '100%',
              height: '100%',
              border: '1px solid #d9d9d9',
              borderRadius: '6px'
            }}
            onLoad={handleIframeLoad}
            onError={handleIframeError}
            title="PowerPaint 图片编辑器"
          />
          
          {serviceStatus === 'connected' && !iframeLoading && (
            <div style={{
              position: 'absolute',
              bottom: '16px',
              right: '16px',
              background: 'rgba(82, 196, 26, 0.9)',
              color: 'white',
              padding: '4px 12px',
              borderRadius: '12px',
              fontSize: '12px',
              zIndex: 5
            }}>
              ✓ PowerPaint 已就绪
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

export default PhotoEditor; 