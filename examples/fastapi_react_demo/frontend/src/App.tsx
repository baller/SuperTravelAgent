import React, { useState, useEffect, useRef } from 'react';
import { Layout, ConfigProvider, theme } from 'antd';
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import ChatInterface from './components/ChatInterface';
import SystemConfig from './components/SystemConfig';
import ToolsPanel from './components/ToolsPanel';
import MCPServersPanel from './components/MCPServersPanel';
import Sidebar from './components/Sidebar';
import { SystemProvider } from './context/SystemContext';
import { ChatHistoryItem } from './hooks/useChatHistory';
import './App.css';

const { Content } = Layout;

const AppContent: React.FC = () => {
  const [darkMode, setDarkMode] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [currentChatId, setCurrentChatId] = useState<string>('');
  const [loadedMessages, setLoadedMessages] = useState<ChatHistoryItem['messages'] | null>(null);
  const chatInterfaceRef = useRef<{ startNewChat: () => void; loadChat: (messages: ChatHistoryItem['messages']) => void }>(null);
  const navigate = useNavigate();

  // 处理新对话
  const handleNewChat = () => {
    console.log('App.tsx - handleNewChat被调用');
    
    // 首先导航到首页，确保ChatInterface组件已渲染
    navigate('/');
    
    // 重置状态
    setCurrentChatId('');
    setLoadedMessages([]); // 设置为空数组而不是null，这样会触发useEffect清空地图
    
    // 使用setTimeout确保ChatInterface组件已经渲染完成
    setTimeout(() => {
      console.log('App.tsx - 准备调用chatInterfaceRef.current?.startNewChat()');
      if (chatInterfaceRef.current) {
        chatInterfaceRef.current.startNewChat();
        console.log('App.tsx - startNewChat调用完成');
      } else {
        console.error('App.tsx - chatInterfaceRef.current仍为null，重试中...');
        // 如果还是null，再等一会儿重试
        setTimeout(() => {
          if (chatInterfaceRef.current) {
            chatInterfaceRef.current.startNewChat();
            console.log('App.tsx - startNewChat重试成功');
          } else {
            console.error('App.tsx - startNewChat重试失败，chatInterfaceRef仍为null');
          }
        }, 100);
      }
    }, 50);
  };

  // 处理选择历史对话
  const handleChatSelect = (chatId: string, messages: ChatHistoryItem['messages']) => {
    console.log('App.tsx - handleChatSelect被调用，chatId:', chatId, '消息数量:', messages.length);
    
    // 导航到首页
    navigate('/');
    
    setCurrentChatId(chatId);
    // 通过 loadedMessages 的变化来触发 ChatInterface 的 useEffect
    // 不再直接调用 loadChat 方法，避免重复处理
    setLoadedMessages([...messages]); // 使用新数组确保触发 useEffect
  };

  // 主题配置 - 豆包风格
  const themeConfig = {
    algorithm: darkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: '#6366f1',
      colorSuccess: '#10b981',
      colorWarning: '#f59e0b',
      colorError: '#ef4444',
      borderRadius: 8,
      colorBgContainer: darkMode ? '#1f2937' : '#ffffff',
      colorBgElevated: darkMode ? '#374151' : '#ffffff',
      colorText: darkMode ? '#f9fafb' : '#1f2937',
      colorTextSecondary: darkMode ? '#d1d5db' : '#6b7280',
      colorBorder: darkMode ? '#4b5563' : '#e5e7eb',
    },
  };

  return (
    <ConfigProvider theme={themeConfig}>
      <SystemProvider>
        <Layout style={{ 
          height: '100vh',
          overflow: 'hidden',
          background: '#f8fafc'
        }}>
          <Layout style={{ flex: 1, overflow: 'hidden' }}>
            <Sidebar 
              collapsed={collapsed} 
              onNewChat={handleNewChat}
              onChatSelect={handleChatSelect}
              onToggleCollapse={() => setCollapsed(!collapsed)}
            />
            
            <Layout style={{ 
              flex: 1,
              overflow: 'hidden',
              background: '#f8fafc'
            }}>
              <Content
                style={{
                  margin: 0,
                  height: '100%',
                  background: '#f8fafc',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column'
                }}
              >
                <Routes>
                  <Route 
                    path="/" 
                    element={
                      <ChatInterface 
                        ref={chatInterfaceRef}
                        currentChatId={currentChatId}
                        loadedMessages={loadedMessages}
                      />
                    } 
                  />
                  <Route path="/config" element={<SystemConfig />} />
                  <Route path="/tools" element={<ToolsPanel />} />
                  <Route path="/mcp-servers" element={<MCPServersPanel />} />
                </Routes>
              </Content>
            </Layout>
          </Layout>
        </Layout>
      </SystemProvider>
    </ConfigProvider>
  );
};

const App: React.FC = () => {
  return (
    <Router>
      <AppContent />
    </Router>
  );
};

export default App; 