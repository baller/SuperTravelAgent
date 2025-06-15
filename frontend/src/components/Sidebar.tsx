import React, { useState } from 'react';
import { Layout, Menu, Button, Dropdown, Modal } from 'antd';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  MessageOutlined,
  SettingOutlined,
  ToolOutlined,
  PlusOutlined,
  HistoryOutlined,
  DeleteOutlined,
  MoreOutlined,
  ExclamationCircleOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  CloudServerOutlined,
  PictureOutlined,
  RobotOutlined
} from '@ant-design/icons';
import { useChatHistory, ChatHistoryItem } from '../hooks/useChatHistory';

const { Sider } = Layout;
const { confirm } = Modal;

interface SidebarProps {
  collapsed: boolean;
  onChatSelect?: (chatId: string, messages: ChatHistoryItem['messages']) => void;
  onNewChat?: () => void;
  onToggleCollapse?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ collapsed, onChatSelect, onNewChat, onToggleCollapse }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { history, deleteChat, clearHistory } = useChatHistory();
  const [showHistory, setShowHistory] = useState(true);

  const menuItems = [
    {
      key: 'new-chat',
      icon: <PlusOutlined />,
      label: '新旅程',
      style: { 
        marginBottom: '8px',
        background: 'linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 100%)',
        border: '1px solid #ddd6fe',
        borderRadius: '12px',
        color: '#7c3aed',
        fontWeight: 600
      }
    },
    {
      key: '/photo-editor',
      icon: <PictureOutlined />,
      label: '旅行照片',
    },
    // 隐藏的菜单项：
    // {
    //   key: '/tools',
    //   icon: <ToolOutlined />,
    //   label: '旅游工具',
    // },
    // {
    //   key: '/mcp-servers',
    //   icon: <CloudServerOutlined />,
    //   label: '旅游服务',
    // },
    // {
    //   key: '/config',
    //   icon: <SettingOutlined />,
    //   label: '系统配置',
    // },
  ];

  const handleMenuClick = (item: any) => {
    console.log('菜单项被点击:', item.key);
    console.log('item对象:', item);
    console.log('onNewChat函数存在:', !!onNewChat);
    
    if (item.key === 'new-chat') {
      console.log('新旅程被点击，调用onNewChat');
      console.log('onNewChat类型:', typeof onNewChat);
      if (onNewChat) {
        console.log('正在调用onNewChat...');
        onNewChat();
        console.log('onNewChat调用完成');
      } else {
        console.warn('onNewChat回调函数未定义');
      }
    } else {
      console.log('导航到:', item.key);
      navigate(item.key);
    }
  };

  const handleChatClick = (chatItem: ChatHistoryItem) => {
    onChatSelect?.(chatItem.id, chatItem.messages);
  };

  const handleDeleteChat = (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    confirm({
      title: '删除旅程',
      icon: <ExclamationCircleOutlined />,
      content: '确定要删除这个旅程记录吗？',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk() {
        deleteChat(chatId);
      },
    });
  };

  const handleClearHistory = () => {
    confirm({
      title: '清空历史',
      icon: <ExclamationCircleOutlined />,
      content: '确定要清空所有旅程历史吗？此操作不可恢复。',
      okText: '清空',
      okType: 'danger',
      cancelText: '取消',
      onOk() {
        clearHistory();
      },
    });
  };

  const getChatDropdownItems = (chatId: string) => [
    {
      key: 'delete',
      label: '删除旅程',
      icon: <DeleteOutlined />,
      danger: true,
      onClick: (e: any) => handleDeleteChat(e.domEvent, chatId)
    }
  ];

  const formatDate = (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return '今天';
    } else if (diffDays === 1) {
      return '昨天';
    } else if (diffDays < 7) {
      return `${diffDays}天前`;
    } else {
      return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    }
  };

  return (
    <Sider 
      trigger={null} 
      collapsible 
      collapsed={collapsed}
      width={240}
      style={{
        background: 'linear-gradient(135deg, #ffffff 0%, #fafbff 100%)',
        borderRight: '1px solid #e2e8f0',
        boxShadow: '4px 0 12px rgba(0, 0, 0, 0.06), 2px 0 4px rgba(0, 0, 0, 0.02)',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* 顶部标题区域 */}
      <div style={{ 
        padding: collapsed ? '16px 8px' : '20px 16px', 
        textAlign: collapsed ? 'center' : 'left',
        borderBottom: '1px solid #e2e8f0',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)'
      }}>
        {!collapsed ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(99, 102, 241, 0.2)'
            }}>
              <RobotOutlined style={{ fontSize: '20px', color: '#ffffff' }} />
            </div>
            <div>
              <div style={{ 
                color: '#1f2937', 
                fontSize: '16px', 
                fontWeight: 600,
                marginBottom: '2px'
              }}>
                SuperTravelAgent
              </div>
              <div style={{ 
                color: '#6b7280', 
                fontSize: '12px' 
              }}>
                智能旅游规划
              </div>
            </div>
          </div>
        ) : (
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(99, 102, 241, 0.2)'
          }}>
            <RobotOutlined style={{ fontSize: '16px', color: '#ffffff' }} />
          </div>
        )}
        
        {/* 折叠/展开按钮 */}
        <Button
          type="text"
          icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={onToggleCollapse}
          style={{
            fontSize: '14px',
            width: 32,
            height: 32,
            color: '#666666',
            borderRadius: '6px',
            flexShrink: 0
          }}
        />
      </div>

      {/* 菜单区域 */}
      <div style={{ padding: '0 12px', marginBottom: '16px', flexShrink: 0 }}>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={handleMenuClick}
          style={{
            background: 'transparent',
            border: 'none',
            fontSize: '14px'
          }}
          className="sidebar-menu-light"
        />
      </div>

      {/* 对话历史区域 */}
      {!collapsed && (
        <div style={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column',
          overflow: 'hidden',
          padding: '0 12px'
        }}>
          {/* 历史标题和操作 */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
            padding: '0 4px'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: '#6b7280',
              fontSize: '13px',
              fontWeight: 500
            }}>
              <HistoryOutlined style={{ fontSize: '14px' }} />
              对话历史
            </div>
            {history.length > 0 && (
              <Button
                type="text"
                size="small"
                icon={<DeleteOutlined />}
                onClick={handleClearHistory}
                style={{
                  color: '#9ca3af',
                  fontSize: '12px',
                  height: '24px',
                  padding: '0 6px'
                }}
              >
                清空
              </Button>
            )}
          </div>

          {/* 历史对话列表 */}
          <div style={{ 
            flex: 1, 
            overflowY: 'auto',
            overflowX: 'hidden'
          }}>
            {history.length === 0 ? (
              <div style={{
                textAlign: 'center',
                color: '#9ca3af',
                fontSize: '13px',
                padding: '20px 0'
              }}>
                暂无对话历史
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {history.map((chatItem) => (
                  <div
                    key={chatItem.id}
                    onClick={() => handleChatClick(chatItem)}
                    className="chat-history-item"
                    style={{
                      padding: '10px 14px',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      background: 'linear-gradient(135deg, #ffffff 0%, #fafbff 100%)',
                      border: '1px solid #f1f5f9',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: '8px',
                      marginBottom: '2px',
                      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)';
                      e.currentTarget.style.borderColor = '#e2e8f0';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                      e.currentTarget.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.08)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'linear-gradient(135deg, #ffffff 0%, #fafbff 100%)';
                      e.currentTarget.style.borderColor = '#f1f5f9';
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.04)';
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        color: '#1f2937',
                        fontSize: '13px',
                        fontWeight: 500,
                        marginBottom: '2px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {chatItem.title}
                      </div>
                      <div style={{
                        color: '#9ca3af',
                        fontSize: '11px'
                      }}>
                        {formatDate(chatItem.updatedAt)}
                      </div>
                    </div>
                    <Dropdown
                      menu={{ items: getChatDropdownItems(chatItem.id) }}
                      trigger={['click']}
                      placement="bottomRight"
                    >
                      <Button
                        type="text"
                        size="small"
                        icon={<MoreOutlined />}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          color: '#9ca3af',
                          width: '20px',
                          height: '20px',
                          padding: 0,
                          minWidth: 'auto',
                          opacity: 0,
                          transition: 'opacity 0.2s ease'
                        }}
                        className="chat-item-more-btn"
                      />
                    </Dropdown>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 隐藏底部用户信息区域 */}
      {false && !collapsed && (
        <div style={{
          flexShrink: 0,
          padding: '16px',
          borderTop: '1px solid #f1f5f9'
        }}>
          <div style={{
            padding: '12px',
            background: '#f8fafc',
            borderRadius: '8px',
            border: '1px solid #e2e8f0'
          }}>
            <div style={{ 
              color: '#1f2937', 
              fontSize: '13px', 
              fontWeight: 500,
              marginBottom: '2px'
            }}>
              体验用户
            </div>
            <div style={{ 
              color: '#6b7280', 
              fontSize: '11px' 
            }}>
              享受智能对话体验
            </div>
          </div>
        </div>
      )}
    </Sider>
  );
};

export default Sidebar; 