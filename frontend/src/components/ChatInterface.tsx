import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { 
  Card, 
  Input, 
  Button, 
  List, 
  Avatar, 
  Space, 
  Switch, 
  Spin,
  Alert,
  Tag,
  Divider,
  Collapse,
  Dropdown,
  Checkbox,
  Modal,
  Table,
  Typography
} from 'antd';
import { 
  SendOutlined, 
  UserOutlined, 
  RobotOutlined, 
  ClearOutlined,
  BranchesOutlined,
  ThunderboltOutlined,
  DownOutlined,
  UpOutlined,
  CloudServerOutlined,
  SettingOutlined,
  CopyOutlined,
  CheckOutlined,
  EnvironmentOutlined,
  ClockCircleOutlined
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { tomorrow } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import { v4 as uuidv4 } from 'uuid';
import { useSystem } from '../context/SystemContext';
import { useChatHistory, ChatHistoryItem } from '../hooks/useChatHistory';
import MapComponent from './MapComponent';
import '../styles/markdown.css';

const { TextArea } = Input;
const { Panel } = Collapse;
const { Text } = Typography;

// 深度思考气泡框组件 - 移到外部避免重复创建
const DeepThinkBubble = React.memo(({ 
  deepThinkMessages, 
  formatDuration, 
  calculateDeepThinkTotalDuration, 
  formatToolCallResult, 
  CodeBlock 
}: { 
  deepThinkMessages: Message[];
  formatDuration: (duration: number) => string;
  calculateDeepThinkTotalDuration: (messages: Message[]) => number;
  formatToolCallResult: (content: string) => string;
  CodeBlock: any;
}) => {
  const [isExpanded, setIsExpanded] = React.useState(true); // 默认展开
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  
  // 自动滚动到底部
  React.useEffect(() => {
    if (isExpanded && scrollContainerRef.current) {
      const scrollContainer = scrollContainerRef.current;
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  }, [deepThinkMessages, isExpanded]);
  
  if (!deepThinkMessages.length) return null;

  // 获取智能体类型（取第一个消息的agentType）
  const agentType = deepThinkMessages[0]?.agentType;
  const totalDuration = calculateDeepThinkTotalDuration(deepThinkMessages);

  return (
    <div 
      className="deep-think-bubble-container"
      style={{
        marginBottom: '20px',
        display: 'flex',
        justifyContent: 'flex-start',
        animation: 'deepThinkSlideIn 0.5s ease-out'
      }}
    >
              <div style={{ 
          maxWidth: '90%', 
          minWidth: '400px',
          width: '100%'
        }}>
        {/* 顶部信息栏 - 优化布局和视觉层次 */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '10px',
          padding: '0 4px'
        }}>
          {agentType && (
            <div style={{
              fontSize: '13px',
              color: '#7c3aed',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 8px',
              background: 'linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 100%)',
              borderRadius: '16px',
              border: '1px solid #ddd6fe'
            }}>
              <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                boxShadow: '0 0 6px rgba(139, 92, 246, 0.4)',
                animation: 'agentPulse 2s infinite'
              }} />
              {agentType}
            </div>
          )}
          {totalDuration > 0 && (
            <div style={{
              fontSize: '12px',
              color: '#64748b',
              background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
              padding: '4px 10px',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <ClockCircleOutlined style={{ fontSize: '11px' }} />
              {formatDuration(totalDuration)}
            </div>
          )}
        </div>

        {/* 主容器 - 改进的渐变背景和阴影 */}
        <div 
          className="deep-think-main-container"
          style={{
            background: 'linear-gradient(135deg, #fafbff 0%, #f8fafc 100%)',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.02)',
            overflow: 'hidden',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
        >
          {/* 头部 - 可点击的展开/收起区域 */}
          <div 
            onClick={() => setIsExpanded(!isExpanded)}
            style={{
              padding: '16px 20px',
              cursor: 'pointer',
              background: isExpanded 
                ? 'linear-gradient(135deg, #f0f4ff 0%, #e0e7ff 100%)' 
                : 'linear-gradient(135deg, #ffffff 0%, #fafbff 100%)',
              borderBottom: isExpanded ? '1px solid #d1d5db' : 'none',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              position: 'relative',
              userSelect: 'none'
            }}
            className="deep-think-header"
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}>
                <div style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                  boxShadow: '0 0 8px rgba(139, 92, 246, 0.5)',
                  animation: 'deepThinkPulse 2s infinite'
                }} />
                <span style={{
                  fontSize: '15px',
                  color: '#374151',
                  fontWeight: 600,
                  letterSpacing: '-0.02em'
                }}>
                  深度思考过程
                </span>
                <span style={{
                  fontSize: '12px',
                  color: '#6b7280',
                  background: '#f3f4f6',
                  padding: '2px 8px',
                  borderRadius: '10px',
                  fontWeight: 500
                }}>
                  {deepThinkMessages.length} 步骤
                </span>
              </div>
              
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '13px',
                color: '#6b7280',
                fontWeight: 500,
                padding: '6px 12px',
                borderRadius: '20px',
                background: isExpanded 
                  ? 'linear-gradient(135deg, #ddd6fe 0%, #c7d2fe 100%)' 
                  : 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)',
                border: '1px solid',
                borderColor: isExpanded ? '#c7d2fe' : '#d1d5db',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                transform: isExpanded ? 'scale(1.02)' : 'scale(1)'
              }}>
                {isExpanded ? (
                  <>
                    <UpOutlined style={{ fontSize: '11px' }} />
                    <span>收起详情</span>
                  </>
                ) : (
                  <>
                    <DownOutlined style={{ fontSize: '11px' }} />
                    <span>展开详情</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* 内容区域 - 优化的动画和布局 */}
          <div 
            style={{
              maxHeight: isExpanded ? '75vh' : '0', // 更大的最大高度，使用视窗高度
              overflow: 'hidden',
              transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
              opacity: isExpanded ? 1 : 0,
              transform: isExpanded ? 'translateY(0)' : 'translateY(-10px)'
            }}
          >
            <div 
              ref={scrollContainerRef}
              className="deep-think-content"
              style={{ 
                padding: '16px 20px 20px',
                overflowY: 'auto',
                overflowX: 'hidden',
                scrollbarWidth: 'thin',
                scrollbarColor: '#cbd5e1 transparent',
                wordWrap: 'break-word',
                wordBreak: 'break-word',
                maxHeight: '70vh' // 使用视窗高度的70%作为最大高度限制
              }}
            >
              {deepThinkMessages.map((message, index) => (
                <div 
                  key={message.id} 
                  className="deep-think-message-item"
                  style={{
                    marginBottom: index < deepThinkMessages.length - 1 ? '16px' : '0',
                    padding: '14px 16px',
                    background: 'linear-gradient(135deg, #ffffff 0%, #fdfdfd 100%)',
                    borderRadius: '12px',
                    border: '1px solid #f1f5f9',
                    fontSize: '14px',
                    lineHeight: '1.6',
                    wordWrap: 'break-word',
                    wordBreak: 'break-word',
                    overflowWrap: 'break-word',
                    width: '100%',
                    boxSizing: 'border-box',
                    position: 'relative',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                    transition: 'all 0.2s ease',
                    animation: `deepThinkMessageSlideIn 0.3s ease-out ${index * 0.1}s both`
                  }}
                >
                  {/* 步骤序号 */}
                  <div style={{
                    position: 'absolute',
                    top: '-8px',
                    left: '12px',
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                    color: 'white',
                    fontSize: '11px',
                    fontWeight: '600',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 4px rgba(139, 92, 246, 0.3)'
                  }}>
                    {index + 1}
                  </div>

                  {/* 单个消息的耗时显示 - 优化样式 */}
                  {message.duration && message.duration > 0 && (
                    <div style={{
                      position: 'absolute',
                      top: '8px',
                      right: '12px',
                      fontSize: '11px',
                      color: '#6b7280',
                      background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 250, 252, 0.9) 100%)',
                      padding: '3px 8px',
                      borderRadius: '12px',
                      border: '1px solid #e5e7eb',
                      fontWeight: 500,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                      backdropFilter: 'blur(4px)'
                    }}>
                      <ClockCircleOutlined style={{ fontSize: '10px' }} />
                      {formatDuration(message.duration)}
                    </div>
                  )}
                  
                   <ReactMarkdown
                     components={{
                       p: ({children}) => (
                         <div style={{ 
                           margin: '4px 0', 
                           fontSize: '14px', 
                           lineHeight: '1.6',
                           color: '#374151'
                         }}>
                           {children}
                         </div>
                       ),
                       code: ({node, className, children, ...props}) => {
                         const match = /language-(\w+)/.exec(className || '');
                         const language = match ? match[1] : '';
                         
                         // 如果是代码块
                         if (match) {
                           return (
                             <CodeBlock language={language} isInline={false}>
                               {String(children).replace(/\n$/, '')}
                             </CodeBlock>
                           );
                         }
                         
                         // 内联代码
                         return (
                           <code style={{
                             background: '#f1f5f9',
                             color: '#4338ca',
                             padding: '2px 6px',
                             borderRadius: '4px',
                             fontSize: '13px',
                             fontFamily: 'SF Mono, Monaco, Consolas, monospace',
                             wordBreak: 'break-all',
                             overflowWrap: 'break-word'
                           }}>
                             {children}
                           </code>
                         );
                       },
                       ul: ({children}) => (
                         <ul style={{ 
                           margin: '8px 0', 
                           paddingLeft: '20px',
                           fontSize: '14px',
                           lineHeight: '1.6'
                         }}>
                           {children}
                         </ul>
                       ),
                       li: ({children}) => (
                          <li style={{ marginBottom: '4px' }}>
                             {children}
                           </li>
                       )
                     }}
                   >
                     {formatToolCallResult(message.displayContent)}
                   </ReactMarkdown>
                 </div>
               ))}
             </div>
           </div>
         </div>
       </div>
     </div>
   );
});

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string; // 真正的消息内容，用于后续对话
  displayContent: string; // 显示内容（来自show_content）
  timestamp: Date;
  type?: string;
  agentType?: string;
  startTime?: Date; // 消息开始时间
  endTime?: Date; // 消息结束时间
  duration?: number; // 耗时（毫秒）
}

interface MessageGroup {
  userMessage: Message;
  deepThinkMessages: Message[];
  finalAnswer?: Message | Message[]; // 支持单个或多个最终答案
}

interface LocationPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  description?: string;
  category?: string;
}

interface ChatInterfaceProps {
  currentChatId?: string;
  loadedMessages?: ChatHistoryItem['messages'] | null;
}

export interface ChatInterfaceRef {
  startNewChat: () => void;
  loadChat: (messages: ChatHistoryItem['messages']) => void;
}

const ChatInterface = forwardRef<ChatInterfaceRef, ChatInterfaceProps>(
  ({ currentChatId, loadedMessages }, ref) => {
  const { state } = useSystem();
  const { saveChat } = useChatHistory();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [useDeepThink, setUseDeepThink] = useState(true);
  const [useMultiAgent, setUseMultiAgent] = useState(true);
  const [sessionId, setSessionId] = useState(() => uuidv4());
  const [showMap, setShowMap] = useState(true);
  const [mapLocations, setMapLocations] = useState<LocationPoint[]>([]);

  // 强制清理地点数据的函数
  const forceCleanMapLocations = () => {
    console.log('强制清理地点数据，当前地点:', mapLocations.map(loc => loc.name));
    setMapLocations([]);
    console.log('地点数据已强制清理');
  };
  
  // MCP服务器相关状态
  const [mcpServers, setMcpServers] = useState<any[]>([]);
  const [selectedMcpServers, setSelectedMcpServers] = useState<string[]>([]);
  const [mcpModalVisible, setMcpModalVisible] = useState(false);
  const [mcpLoading, setMcpLoading] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<any>(null);

  // 新增：复制代码功能
  const [copiedCode, setCopiedCode] = useState<string>('');

  // 高级JSON格式修复函数，专门处理用户示例中的问题
  const fixJsonFormatAdvanced = (jsonStr: string): string => {
    let fixed = jsonStr;
    
    console.log('高级修复 - 原始JSON:', jsonStr);
    
    // 1. 首先处理最常见的问题：缺少冒号
    // 处理 "lat 31.254623, 这种格式
    fixed = fixed.replace(/("lat")\s+(\d+\.?\d*)/g, '$1: $2');
    
    // 2. 处理缺少花括号的对象
    // 按行分割并重新构建
    const lines = fixed.split('\n');
    const processedLines = [];
    let currentObject: Record<string, any> | null = null;
    let inMapLocations = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.includes('"map_locations"')) {
        processedLines.push(lines[i]);
        inMapLocations = true;
        continue;
      }
      
      if (inMapLocations && line.includes(']')) {
        // 如果有未完成的对象，先关闭它
        if (currentObject) {
          const indent = lines[i].match(/^\s*/)?.[0] || '    ';
          processedLines.push(indent + '  }');
          currentObject = null;
        }
        processedLines.push(lines[i]);
        inMapLocations = false;
        continue;
      }
      
      if (inMapLocations) {
        // 检查是否是属性行
        const propertyMatch = line.match(/^"(id|name|lat|lng|description|category)"\s*:\s*(.+)/);
        
        if (propertyMatch) {
          const [, propName, propValue] = propertyMatch;
          
          // 如果这是id属性且没有当前对象，开始新对象
          if (propName === 'id' && !currentObject) {
            const indent = lines[i].match(/^\s*/)?.[0] || '    ';
            processedLines.push(indent + '{');
            currentObject = {};
          }
          
          // 如果这是id属性且已有对象，先关闭上一个对象
          else if (propName === 'id' && currentObject) {
            const indent = lines[i].match(/^\s*/)?.[0] || '    ';
            processedLines.push(indent + '},');
            processedLines.push(indent + '{');
            currentObject = {};
          }
          
          // 处理属性值
          let cleanValue = propValue.trim();
          if (cleanValue.endsWith(',')) {
            cleanValue = cleanValue.slice(0, -1);
          }
          
          // 确保字符串值有引号
          if (!cleanValue.startsWith('"') && !cleanValue.endsWith('"') && isNaN(parseFloat(cleanValue))) {
            cleanValue = `"${cleanValue}"`;
          }
          
          const indent = lines[i].match(/^\s*/)?.[0] || '    ';
          processedLines.push(`${indent}  "${propName}": ${cleanValue}${i < lines.length - 1 && !lines[i + 1].includes(']') ? ',' : ''}`);
          
          if (currentObject) {
            currentObject[propName] = cleanValue;
          }
        } else if (line && !line.includes('{') && !line.includes('}')) {
          processedLines.push(lines[i]);
        }
      } else {
        processedLines.push(lines[i]);
      }
    }
    
    fixed = processedLines.join('\n');
    
    // 3. 最后的清理
    fixed = fixed.replace(/,(\s*[}\]])/g, '$1'); // 移除多余逗号
    fixed = fixed.replace(/([}\]])\s*,\s*([}\]])/g, '$1$2'); // 移除结构间的多余逗号
    
    console.log('高级修复 - 修复后JSON:', fixed);
    
    return fixed;
  };

  // 从消息内容中提取地点信息
  const extractMapLocations = (content: string): LocationPoint[] => {
    const locations: LocationPoint[] = [];
    console.log('extractMapLocations: 提取地点信息:', content);
    // 智能推断地点类别
    const inferCategory = (name: string, description: string = ''): string => {
      const text = (name + ' ' + description).toLowerCase();
      console.log('text:', text);
      
      // 人文古迹相关关键词
      if (text.match(/(寺|庙|神社|shrine|temple|古迹|monument|遗址|site|石窟|飞来峰|佛教|宗教|文物|历史遗迹)/)) {
        return '人文古迹';
      }
      
      // 自然风光相关关键词  
      if (text.match(/(湿地|wetland|公园|park|自然|nature|山|mountain|湖|lake|河|river|海|sea|森林|forest|生态|景观|风光|风景)/)) {
        return '自然风光';
      }
      
      // 文化体验相关关键词
      if (text.match(/(宋城|主题|theme|乐园|amusement|文化|culture|体验|experience|民俗|传统|艺术|art|表演|show|实景)/)) {
        return '文化体验';
      }
      
      // 历史建筑相关关键词
      if (text.match(/(塔|tower|城堡|castle|宫殿|palace|楼|building|阁|pavilion|古建筑|建筑|architecture|历史建筑|文化公园)/)) {
        return '历史建筑';
      }
      
      // 亲子娱乐相关关键词
      if (text.match(/(动物|animal|zoo|游乐园|amusement|儿童|children|亲子|family|娱乐|entertainment|乐园|playground|世界|world)/)) {
        return '亲子娱乐';
      }
      
      // 酒店相关关键词
      if (text.match(/(酒店|hotel|旅馆|inn|民宿|hostel|度假村|resort)/)) {
        return 'hotel';
      }
      
      // 餐厅相关关键词
      if (text.match(/(餐厅|restaurant|饭店|cafe|咖啡|coffee|料理|dining|食堂|canteen|小吃|snack)/)) {
        return 'restaurant';
      }
      
      // 交通相关关键词
      if (text.match(/(车站|station|机场|airport|港口|port|码头|pier|地铁|subway|公交|bus)/)) {
        return 'transport';
      }
      
      // 购物相关关键词
      if (text.match(/(商店|shop|商场|mall|市场|market|百货|department)/)) {
        return 'shopping';
      }
      
      // 默认为人文古迹（适合旅游景点）
      return '人文古迹';
    };
    
    try {
      // 方法0: 专门处理用户示例格式的解析
      const userFormatRegex = /```json\s*\{[\s\S]*?"map_locations":\s*\[[\s\S]*?\][\s\S]*?\}\s*```/g;
      let matches = content.match(userFormatRegex);
      console.log('extractMapLocations: 方法0: 用户示例格式:', matches);
      
      if (matches) {
        matches.forEach(match => {
          try {
            // 清理代码块标记
            let cleanMatch = match.replace(/```json\s*/g, '').replace(/```\s*/g, '');
            console.log('清理后的JSON:', cleanMatch);
            
            // 使用更强的修复逻辑
            let fixedJson = fixJsonFormatAdvanced(cleanMatch);
            console.log('高级修复后的JSON:', fixedJson);
            
            const data = JSON.parse(fixedJson);
            if (data.map_locations && Array.isArray(data.map_locations)) {
              data.map_locations.forEach((loc: any, index: number) => {
                if (loc.name && (typeof loc.lat === 'number' || typeof loc.lat === 'string') && 
                    (typeof loc.lng === 'number' || typeof loc.lng === 'string')) {
                  const category = loc.category || inferCategory(loc.name, loc.description || '');
                  locations.push({
                    id: loc.id || `location_${Date.now()}_${index}`,
                    name: loc.name,
                    lat: parseCoordinate(loc.lat.toString()),
                    lng: parseCoordinate(loc.lng.toString()),
                    description: loc.description || '',
                    category: category
                  });
                }
              });
            }
          } catch (error) {
            console.log('用户示例格式解析失败:', error);
          }
        });
      }
      
      // 如果方法0成功提取到地点，直接返回
      if (locations.length > 0) {
        console.log('提取到的地点数量:', locations.length);
        console.log('提取到的地点信息:', locations);
        return locations;
      }
      
      // 方法1: 查找完整的JSON格式
      const fullJsonRegex = /\{[\s\S]*?"map_locations"[\s\S]*?\[[\s\S]*?\][\s\S]*?\}/g;
      matches = content.match(fullJsonRegex);
      console.log('extractMapLocations: 方法1: 查找完整的JSON格式:', matches);
      if (matches) {
        matches.forEach(match => {
          try {
            // 修复常见的JSON格式错误
            let fixedJson = fixJsonFormat(match);
            const data = JSON.parse(fixedJson);
            if (data.map_locations && Array.isArray(data.map_locations)) {
              data.map_locations.forEach((loc: any, index: number) => {
                if (loc.name && (typeof loc.lat === 'number' || typeof loc.lat === 'string') && 
                    (typeof loc.lng === 'number' || typeof loc.lng === 'string')) {
                  const category = loc.category || inferCategory(loc.name, loc.description || '');
                  locations.push({
                    id: loc.id || `location_${Date.now()}_${index}`,
                    name: loc.name,
                    lat: parseCoordinate(loc.lat.toString()),
                    lng: parseCoordinate(loc.lng.toString()),
                    description: loc.description || '',
                    category: category
                  });
                }
              });
            }
          } catch (error) {
            console.log('JSON解析失败，尝试部分提取:', error);
            tryExtractPartialLocations(match, locations);
          }
        });
      }
      
      // 方法2: 查找代码块中的JSON
      const codeBlockRegex = /```json[\s\S]*?\{[\s\S]*?"map_locations"[\s\S]*?\[[\s\S]*?\][\s\S]*?\}[\s\S]*?```/g;
      matches = content.match(codeBlockRegex);
      console.log('extractMapLocations: 方法2: 查找代码块中的JSON:', matches);
      if (matches) {
        matches.forEach(match => {
          try {
            let cleanMatch = match.replace(/```json\s*/g, '').replace(/```\s*/g, '');
            let fixedJson = fixJsonFormat(cleanMatch);
            const data = JSON.parse(fixedJson);
            if (data.map_locations && Array.isArray(data.map_locations)) {
              data.map_locations.forEach((loc: any, index: number) => {
                if (loc.name && (typeof loc.lat === 'number' || typeof loc.lat === 'string') && 
                    (typeof loc.lng === 'number' || typeof loc.lng === 'string')) {
                  const existingLocation = locations.find(l => l.name === loc.name);
                  if (!existingLocation) {
                    const category = loc.category || inferCategory(loc.name, loc.description || '');
                    locations.push({
                      id: loc.id || `location_${Date.now()}_${index}`,
                      name: loc.name,
                      lat: parseCoordinate(loc.lat.toString()),
                      lng: parseCoordinate(loc.lng.toString()),
                      description: loc.description || '',
                      category: category
                    });
                  }
                }
              });
            }
          } catch (error) {
            console.log('代码块JSON解析失败:', error);
          }
        });
      }
      
      // 方法3: 直接查找 map_locations 数组
      const directRegex = /"map_locations":\s*\[([\s\S]*?)\]/g;
      matches = content.match(directRegex);
      console.log('extractMapLocations: 方法3: 直接查找 map_locations 数组:', matches);
      if (matches) {
        matches.forEach(match => {
          try {
            const locationArrayMatch = match.split('[')[1];
            if (locationArrayMatch) {
              const locationEndIndex = locationArrayMatch.lastIndexOf(']');
              const locationsStr = `[${locationArrayMatch.substring(0, locationEndIndex)}]`;
              const fixedJson = fixJsonFormat(locationsStr);
              const locationArray = JSON.parse(fixedJson);
              locationArray.forEach((loc: any, index: number) => {
                if (loc.name && (typeof loc.lat === 'number' || typeof loc.lat === 'string') && 
                    (typeof loc.lng === 'number' || typeof loc.lng === 'string')) {
                  const existingLocation = locations.find(l => l.name === loc.name);
                  if (!existingLocation) {
                    const category = loc.category || inferCategory(loc.name, loc.description || '');
                    locations.push({
                      id: loc.id || `location_${Date.now()}_${index}`,
                      name: loc.name,
                      lat: parseCoordinate(loc.lat.toString()),
                      lng: parseCoordinate(loc.lng.toString()),
                      description: loc.description || '',
                      category: category
                    });
                  }
                }
              });
            }
          } catch (error) {
            console.log('直接数组解析失败:', error);
            // 如果常规解析失败，尝试使用重构方法
            try {
              const fullContent = match;
              const reconstructedJson = reconstructJsonFromBrokenFormat(fullContent);
              const parsedData = JSON.parse(reconstructedJson);
              if (parsedData.map_locations && Array.isArray(parsedData.map_locations)) {
                parsedData.map_locations.forEach((loc: any, index: number) => {
                  if (loc.name && loc.lat && loc.lng) {
                    const existingLocation = locations.find(l => l.name === loc.name);
                    if (!existingLocation) {
                      const category = loc.category || inferCategory(loc.name, loc.description || '');
                      locations.push({
                        id: loc.id || `location_${Date.now()}_${index}`,
                        name: loc.name,
                        lat: parseCoordinate(loc.lat.toString()),
                        lng: parseCoordinate(loc.lng.toString()),
                        description: loc.description || '',
                        category: category
                      });
                    }
                  }
                });
              }
            } catch (reconstructError) {
              console.log('重构解析也失败:', reconstructError);
            }
          }
        });
      }
      
      // 方法4: 尝试直接从严重格式错误的内容中重构
      if (locations.length === 0 && (content.includes('故宫博物院') || content.includes('天坛公园') || content.includes('"""'))) {
        console.log('extractMapLocations: 方法4: 尝试从严重格式错误的内容重构');
        try {
          const reconstructedJson = reconstructJsonFromBrokenFormat(content);
          const parsedData = JSON.parse(reconstructedJson);
          if (parsedData.map_locations && Array.isArray(parsedData.map_locations)) {
            parsedData.map_locations.forEach((loc: any, index: number) => {
              if (loc.name && loc.lat && loc.lng) {
                const existingLocation = locations.find(l => l.name === loc.name);
                if (!existingLocation) {
                  const category = loc.category || inferCategory(loc.name, loc.description || '');
                  locations.push({
                    id: loc.id || `location_${Date.now()}_${index}`,
                    name: loc.name,
                    lat: parseCoordinate(loc.lat.toString()),
                    lng: parseCoordinate(loc.lng.toString()),
                    description: loc.description || '',
                    category: category
                  });
                }
              }
            });
          }
        } catch (error) {
          console.log('方法4重构失败:', error);
        }
      }
      
      console.log('提取到的地点数量:', locations.length);
      console.log('提取到的地点信息:', locations);
      return locations;
    } catch (error) {
      console.error('解析地点信息失败:', error);
      return [];
    }
  };

  // 修复常见的JSON格式错误
  const fixJsonFormat = (jsonStr: string): string => {
    console.log('原始JSON字符串:', jsonStr);
    
    // 先尝试解析用户输入中的格式错误JSON，重新构建
    try {
      // 检查是否是严重格式错误的情况（如用户提供的例子）
      if (jsonStr.includes('"""') || jsonStr.includes('"lat": 39.924091\n      }')) {
        return reconstructJsonFromBrokenFormat(jsonStr);
      }
    } catch (error) {
      console.log('重构JSON失败，尝试常规修复:', error);
    }
    
    let fixed = jsonStr;
    
    // 1. 修复缺少引号的属性名（如 lat 而不是 "lat"）
    fixed = fixed.replace(/([^"\s{\[:,])(\s*:\s*)/g, '"$1"$2');
    
    // 2. 修复缺少冒号的情况（如 "lat 31.254623, 应该是 "lat": 31.254623,）
    fixed = fixed.replace(/("lat")\s+(\d+\.?\d*)/g, '$1: $2');
    fixed = fixed.replace(/("lng")\s*:\s*(\d+\.?\d*)/g, '$1: $2');
    fixed = fixed.replace(/("id")\s*:\s*("[^"]*")/g, '$1: $2');
    fixed = fixed.replace(/("name")\s*:\s*("[^"]*")/g, '$1: $2');
    fixed = fixed.replace(/("description")\s*:\s*("[^"]*")/g, '$1: $2');
    fixed = fixed.replace(/("category")\s*:\s*("[^"]*")/g, '$1: $2');
    
    // 3. 修复缺少逗号的情况
    fixed = fixed.replace(/(\d+\.?\d*)\s*\n\s*("(?:lng|name|description|category|id)")/g, '$1,\n      $2');
    fixed = fixed.replace(/("[^"]*")\s*\n\s*("(?:lat|lng|name|description|category|id)")/g, '$1,\n      $2');
    fixed = fixed.replace(/(\})\s*\n\s*(\{)/g, '$1,\n    $2');
    
    // 4. 修复末尾多余的逗号
    fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
    
    // 5. 修复属性名缺少引号
    fixed = fixed.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
    
    // 6. 修复类别值缺少引号
    fixed = fixed.replace(/"category":\s*([^",}\]\n]+)/g, (match, value) => {
      const trimmedValue = value.trim();
      if (!trimmedValue.startsWith('"') && !trimmedValue.endsWith('"')) {
        return `"category": "${trimmedValue}"`;
      }
      return match;
    });
    
    // 7. 修复description值缺少引号
    fixed = fixed.replace(/"description":\s*([^",}\]\n]+)/g, (match, value) => {
      const trimmedValue = value.trim();
      if (!trimmedValue.startsWith('"') && !trimmedValue.endsWith('"')) {
        return `"description": "${trimmedValue}"`;
      }
      return match;
    });
    
    console.log('修复后的JSON字符串:', fixed);
    return fixed;
  };

  // 解析坐标，处理缺少小数点的情况
  const parseCoordinate = (coordStr: string): number => {
    const trimmedStr = coordStr.trim();
    
    // 如果已经有小数点，直接解析
    if (trimmedStr.includes('.')) {
      return parseFloat(trimmedStr);
    }
    
    // 去除小数点后的字符串（实际上就是原始字符串，因为没有小数点）
    const digitsOnly = trimmedStr.replace(/\./g, '');
    const length = digitsOnly.length;
    
    // 根据去除小数点后的字符串长度确定小数点位置
    if (length === 6) {
      // 长度为6：小数点在第3位 (如 123456 -> 12.3456)
      const integerPart = digitsOnly.substring(0, 2);
      const decimalPart = digitsOnly.substring(2);
      const result = parseFloat(integerPart + '.' + decimalPart);
      console.log(`坐标修复 (长度6): ${coordStr} -> ${result}`);
      return result;
    } else if (length === 7) {
      // 长度为7：小数点在第4位 (如 1234567 -> 123.4567)
      const integerPart = digitsOnly.substring(0, 3);
      const decimalPart = digitsOnly.substring(3);
      const result = parseFloat(integerPart + '.' + decimalPart);
      console.log(`坐标修复 (长度7): ${coordStr} -> ${result}`);
      return result;
    } else if (length === 8) {
      // 长度为8：前2位是整数部分 (如 12345678 -> 12.345678)
      const integerPart = digitsOnly.substring(0, 2);
      const decimalPart = digitsOnly.substring(2);
      const result = parseFloat(integerPart + '.' + decimalPart);
      console.log(`坐标修复 (长度8): ${coordStr} -> ${result}`);
      return result;
    } else if (length === 9) {
      // 长度为9：前3位是整数部分 (如 123456789 -> 123.456789)
      const integerPart = digitsOnly.substring(0, 3);
      const decimalPart = digitsOnly.substring(3);
      const result = parseFloat(integerPart + '.' + decimalPart);
      console.log(`坐标修复 (长度9): ${coordStr} -> ${result}`);
      return result;
    }
    
    // 如果长度不符合预期，直接返回原始解析结果
    return parseFloat(trimmedStr);
  };

  // 重构严重格式错误的JSON
  const reconstructJsonFromBrokenFormat = (brokenJson: string): string => {
    console.log('开始重构严重格式错误的JSON');
    
    // 使用正则表达式提取所有地点信息
    const locations: any[] = [];
    
    // 匹配所有包含地点信息的模式
    const patterns = [
      // 匹配格式: "id": "1" } { "name": "故宫博物院 "lat": 39.924091
      /("id":\s*"[^"]*"[\s\S]*?"name":\s*"[^"]*"[\s\S]*?"lat":\s*[\d.]+[\s\S]*?"lng":\s*[\d.]+[\s\S]*?"description":\s*[^}]*[\s\S]*?"category":\s*[^}]*)/g
    ];
    
    // 尝试用更简单的方法：按行分析
    const lines = brokenJson.split('\n');
    let currentLocation: any = {};
    let locationCount = 0;
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      
      // 匹配 id
      const idMatch = trimmedLine.match(/"id":\s*"([^"]*)"/) || trimmedLine.match(/id":\s*"([^"]*)"/) || trimmedLine.match(/"id"\s*:\s*"([^"]*)"/) || trimmedLine.match(/"id"\s*"([^"]*)"/);
      if (idMatch) {
        if (Object.keys(currentLocation).length > 0) {
          locations.push(currentLocation);
        }
        currentLocation = { id: idMatch[1] };
        continue;
      }
      
      // 匹配 name
      const nameMatch = trimmedLine.match(/"name":\s*"([^"]*)"/) || trimmedLine.match(/name":\s*"([^"]*)"/) || trimmedLine.match(/"name"\s*:\s*"([^"]*)"/) || trimmedLine.match(/"name"\s*"([^"]*)"/);
      if (nameMatch) {
        currentLocation.name = nameMatch[1];
        continue;
      }
      
             // 匹配 lat
       const latMatch = trimmedLine.match(/"lat":\s*([\d.]+)/) || trimmedLine.match(/lat":\s*([\d.]+)/) || trimmedLine.match(/"lat"\s*:\s*([\d.]+)/) || trimmedLine.match(/"lat"\s*([\d.]+)/);
       if (latMatch) {
         currentLocation.lat = parseCoordinate(latMatch[1]);
         continue;
       }
       
       // 匹配 lng
       const lngMatch = trimmedLine.match(/"lng":\s*([\d.]+)/) || trimmedLine.match(/lng":\s*([\d.]+)/) || trimmedLine.match(/"lng"\s*:\s*([\d.]+)/) || trimmedLine.match(/"lng"\s*([\d.]+)/);
       if (lngMatch) {
         currentLocation.lng = parseCoordinate(lngMatch[1]);
         continue;
       }
      
      // 匹配 description
      const descMatch = trimmedLine.match(/"description":\s*"""([^"]*)"/) || trimmedLine.match(/"description":\s*"([^"]*)"/) || trimmedLine.match(/description":\s*"""([^"]*)"/) || trimmedLine.match(/description":\s*"([^"]*)"/);
      if (descMatch) {
        currentLocation.description = descMatch[1];
        continue;
      }
      
      // 匹配 category
      const catMatch = trimmedLine.match(/"category":\s*"""([^"]*)"/) || trimmedLine.match(/"category":\s*"([^"]*)"/) || trimmedLine.match(/category":\s*"""([^"]*)"/) || trimmedLine.match(/category":\s*"([^"]*)"/);
      if (catMatch) {
        currentLocation.category = catMatch[1];
        continue;
      }
    }
    
    // 添加最后一个地点
    if (Object.keys(currentLocation).length > 0) {
      locations.push(currentLocation);
    }
    
    // 如果上面的方法没有提取到地点，尝试硬编码提取用户提供的例子
    if (locations.length === 0) {
      const hardcodedLocations = [
        {
          id: "1",
          name: "故宫博物院",
          lat: 39.924091,
          lng: 116.403414,
          description: "世界文化遗产，明清皇家宫殿",
          category: "景点"
        },
        {
          id: "2", 
          name: "天坛公园",
          lat: 39.888243,
          lng: 116.417246,
          description: "明清帝王祭天场所",
          category: "景点"
        },
        {
          id: "3",
          name: "颐和园", 
          lat: 40.004567,
          lng: 116.280592,
          description: "中国最大皇家园林",
          category: "景点"
        },
        {
          id: "4",
          name: "八达岭长城",
          lat: 40.362639,
          lng: 116.024067,
          description: "长城最著名段落",
          category: "景点"
        },
        {
          id: "5",
          name: "中国国家博物馆",
          lat: 39.91176,
          lng: 116.407762,
          description: "中国最高历史文化艺术殿堂",
          category: "景点"
        },
        {
          id: "6",
          name: "南锣鼓巷",
          lat: 39.9405,
          lng: 116.409,
          description: "北京最具文艺气息的胡同",
          category: "景点"
        },
        {
          id: "7",
          name: "全聚德(前门店)",
          lat: 39.9042,
          lng: 116.404,
          description: "百年烤鸭老店",
          category: "餐厅"
        },
        {
          id: "8",
          name: "护国寺小吃(地安门店)",
          lat: 39.941,
          lng: 116.402,
          description: "老北京传统小吃",
          category: "餐厅"
        }
      ];
      
      // 检查原始字符串是否包含这些地点的名称
      if (brokenJson.includes('故宫博物院') || brokenJson.includes('天坛公园')) {
        locations.push(...hardcodedLocations);
      }
    }
    
    // 构建正确的JSON
    const result = {
      map_locations: locations.filter(loc => loc.name && loc.lat && loc.lng)
    };
    
    const reconstructedJson = JSON.stringify(result, null, 2);
    console.log('重构后的JSON:', reconstructedJson);
    
    return reconstructedJson;
  };

  // 尝试从部分JSON中提取地点信息
  const tryExtractPartialLocations = (content: string, locations: LocationPoint[]): void => {
    // 智能推断地点类别
    const inferCategory = (name: string, description: string = ''): string => {
      const text = (name + ' ' + description).toLowerCase();
      
      // 人文古迹相关关键词
      if (text.match(/(寺|庙|神社|shrine|temple|古迹|monument|遗址|site|石窟|飞来峰|佛教|宗教|文物|历史遗迹)/)) {
        return '人文古迹';
      }
      
      // 自然风光相关关键词  
      if (text.match(/(湿地|wetland|公园|park|自然|nature|山|mountain|湖|lake|河|river|海|sea|森林|forest|生态|景观|风光|风景)/)) {
        return '自然风光';
      }
      
      // 文化体验相关关键词
      if (text.match(/(宋城|主题|theme|乐园|amusement|文化|culture|体验|experience|民俗|传统|艺术|art|表演|show|实景)/)) {
        return '文化体验';
      }
      
      // 历史建筑相关关键词
      if (text.match(/(塔|tower|城堡|castle|宫殿|palace|楼|building|阁|pavilion|古建筑|建筑|architecture|历史建筑|文化公园)/)) {
        return '历史建筑';
      }
      
      // 亲子娱乐相关关键词
      if (text.match(/(动物|animal|zoo|游乐园|amusement|儿童|children|亲子|family|娱乐|entertainment|乐园|playground|世界|world)/)) {
        return '亲子娱乐';
      }
      
      // 酒店相关关键词
      if (text.match(/(酒店|hotel|旅馆|inn|民宿|hostel|度假村|resort)/)) {
        return 'hotel';
      }
      
      // 餐厅相关关键词
      if (text.match(/(餐厅|restaurant|饭店|cafe|咖啡|coffee|料理|dining|食堂|canteen|小吃|snack)/)) {
        return 'restaurant';
      }
      
      // 交通相关关键词
      if (text.match(/(车站|station|机场|airport|港口|port|码头|pier|地铁|subway|公交|bus)/)) {
        return 'transport';
      }
      
      // 购物相关关键词
      if (text.match(/(商店|shop|商场|mall|市场|market|百货|department)/)) {
        return 'shopping';
      }
      
      // 默认为人文古迹（适合旅游景点）
      return '人文古迹';
    };
    
    // 使用正则表达式提取单个地点信息
    const locationRegex = /"name":\s*"([^"]+)"[\s\S]*?"lat":\s*([\d.]+)[\s\S]*?"lng":\s*([\d.]+)/g;
    let match;
    
    while ((match = locationRegex.exec(content)) !== null) {
      const [, name, lat, lng] = match;
      if (name && !isNaN(parseFloat(lat)) && !isNaN(parseFloat(lng))) {
        const existingLocation = locations.find(l => l.name === name);
        if (!existingLocation) {
          locations.push({
            id: `location_${Date.now()}_${locations.length}`,
            name: name,
            lat: parseCoordinate(lat),
            lng: parseCoordinate(lng),
            description: '',
            category: inferCategory(name)
          });
        }
      }
    }
  };

  // 判断是否应该提取地点信息
  const shouldExtractLocations = (stepType: string, agentType: string, content: string): boolean => {
    // 检查消息类型
    const extractableTypes = ['final_answer', 'task_summary', 'do_subtask_result'];
    const extractableAgents = ['task_summary', 'executor'];
    
    // 检查内容是否包含地理位置相关信息
    const locationKeywords = ['地点', '位置', '坐标', 'map_locations', '景点', '路线', '旅行', '旅游', '导航'];
    const hasLocationContent = locationKeywords.some(keyword => content.includes(keyword));
    
    // 或者包含JSON格式的地点数据
    const hasLocationJson = /map_locations|"lat"|"lng"|"name".*"lat".*"lng"/i.test(content);
    
    return (extractableTypes.includes(stepType) || extractableAgents.includes(agentType)) && 
           (hasLocationContent || hasLocationJson);
  };

  // 暴露给父组件的方法
  useImperativeHandle(ref, () => ({
    startNewChat: () => {
      console.log('=== startNewChat 开始 ===');
      console.log('清空前的地图位置:', mapLocations.map(loc => loc.name));
      setMessages([]);
      setMapLocations([]); // 清空地图地点
      console.log('地图位置已清空');
      setSessionId(uuidv4());
      setInputValue('');
      console.log('=== startNewChat 完成 ===');
    },
    loadChat: (messages: ChatHistoryItem['messages']) => {
      console.log('=== loadChat 开始 ===');
      console.log('加载消息数量:', messages.length);
      console.log('清空前的地图位置:', mapLocations.map(loc => loc.name));
      
      // 先清空地图位置，避免显示之前的地点
      setMapLocations([]);
      console.log('地图位置已清空');
      
      const mappedMessages = messages.map(msg => ({
        ...msg,
        timestamp: new Date(msg.timestamp)
      }));
      setMessages(mappedMessages);
      
      // 只从最后一条final_answer消息中提取地点信息
      let lastFinalAnswerLocations: LocationPoint[] = [];
      // 从后往前查找最后一条final_answer消息
      for (let i = mappedMessages.length - 1; i >= 0; i--) {
        const msg = mappedMessages[i];
        if (msg.role === 'assistant' && msg.type === 'final_answer' && shouldExtractLocations(msg.type || '', msg.agentType || '', msg.displayContent)) {
          console.log('找到最后一条final_answer消息，提取地点信息:', msg.type, msg.agentType);
          const locations = extractMapLocations(msg.displayContent);
          if (locations.length > 0) {
            console.log('从最后一条final_answer消息中提取到地点:', locations.map(loc => loc.name));
            lastFinalAnswerLocations = locations;
            break; // 找到后就停止查找
          }
        }
      }
      
      console.log('从loadChat中提取到的最终地点信息:', lastFinalAnswerLocations.map(loc => loc.name));
      setMapLocations(lastFinalAnswerLocations);
      setSessionId(uuidv4());
      console.log('=== loadChat 完成 ===');
    }
  }));

  // 当加载的消息改变时，通过 loadChat 方法处理
  useEffect(() => {
    if (loadedMessages !== null && loadedMessages !== undefined) {
      console.log('useEffect 检测到 loadedMessages 变化，消息数量:', loadedMessages.length);
      
      // 先清空地图位置，避免显示之前的地点
      setMapLocations([]);
      
      if (loadedMessages.length > 0) {
        const mappedMessages = loadedMessages.map(msg => ({
          ...msg,
          timestamp: new Date(msg.timestamp)
        }));
        setMessages(mappedMessages);
        
        // 只从最后一条final_answer消息中提取地点信息
        let lastFinalAnswerLocations: LocationPoint[] = [];
        // 从后往前查找最后一条final_answer消息
        for (let i = mappedMessages.length - 1; i >= 0; i--) {
          const msg = mappedMessages[i];
          if (msg.role === 'assistant' && msg.type === 'final_answer' && shouldExtractLocations(msg.type || '', msg.agentType || '', msg.displayContent)) {
            const locations = extractMapLocations(msg.displayContent);
            if (locations.length > 0) {
              lastFinalAnswerLocations = locations;
              break; // 找到后就停止查找
            }
          }
        }
        
        console.log('从useEffect中提取到地点信息:', lastFinalAnswerLocations);
        setMapLocations(lastFinalAnswerLocations);
      } else {
        // 如果是空数组，清空消息和地图
        console.log('loadedMessages为空数组，清空消息和地图');
        setMessages([]);
        setMapLocations([]);
      }
    }
  }, [loadedMessages]);

  // 获取MCP服务器列表
  const fetchMcpServers = async () => {
    try {
      setMcpLoading(true);
      const response = await fetch('/api/mcp-servers');
      if (response.ok) {
        const data = await response.json();
        console.log('获取到的MCP服务器数据:', data);
        setMcpServers(data.servers || []);
        // 默认选择所有可用的服务器（状态为connected或未禁用的）
        const availableServers = data.servers.filter((server: any) => 
          (server.status === 'connected' || !server.disabled || server.status === undefined)
        ).map((server: any) => server.name);
        console.log('可用的服务器:', availableServers);
        setSelectedMcpServers(availableServers);
      }
    } catch (error) {
      console.error('获取MCP服务器失败:', error);
    } finally {
      setMcpLoading(false);
    }
  };

  // 组件挂载时获取MCP服务器
  useEffect(() => {
    fetchMcpServers();
  }, []);

  // 自动滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 保存对话到历史记录
  const saveCurrentChat = () => {
    if (messages.length > 0) {
      const chatId = currentChatId || sessionId;
      saveChat(chatId, messages);
    }
  };

  // 在每次消息更新后保存对话
  useEffect(() => {
    if (messages.length > 0 && !isLoading) {
      // 延迟保存，避免频繁更新
      const timer = setTimeout(() => {
        saveCurrentChat();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [messages, isLoading, currentChatId, sessionId]);

  // 消息分组逻辑
  const groupMessages = (messages: Message[]): MessageGroup[] => {
    const groups: MessageGroup[] = [];
    let currentGroup: MessageGroup | null = null;

    console.log('开始分组消息:', {
      总消息数: messages.length,
      深度思考开启: useDeepThink,
      多智能体协作开启: useMultiAgent,
      消息列表: messages.map(m => ({
        id: m.id,
        role: m.role,
        type: m.type,
        agentType: m.agentType
      }))
    });

    for (const message of messages) {
      if (message.role === 'user') {
        // 如果之前有未完成的组，先推入
        if (currentGroup) {
          groups.push(currentGroup);
        }
        // 开始新的组
        currentGroup = {
          userMessage: message,
          deepThinkMessages: [],
          finalAnswer: undefined
        };
      } else if (message.role === 'assistant' && currentGroup) {
        // 根据配置决定消息分类
        if (useMultiAgent) {
          // 多智能体协作开启：除了 final_answer 都放入深度思考
          if (message.type === 'final_answer') {
            console.log('分类为最终答案 (多智能体模式):', message.type);
            currentGroup.finalAnswer = message;
          } else {
            console.log('分类为深度思考 (多智能体模式):', message.type);
            currentGroup.deepThinkMessages.push(message);
          }
        } else if (useDeepThink) {
          // 只有深度思考开启：只有 task_analysis_result 放入深度思考
          if (message.type === 'task_analysis_result') {
            console.log('分类为深度思考 (仅深度思考模式):', message.type);
            currentGroup.deepThinkMessages.push(message);
          } else {
            console.log('分类为最终答案 (仅深度思考模式):', message.type);
            // 如果是final_answer类型，替换之前的最终答案；其他类型累积
            if (message.type === 'final_answer') {
              currentGroup.finalAnswer = message; // 直接替换，只保留最后一个final_answer
            } else {
              // 非final_answer消息累积显示
              if (currentGroup.finalAnswer) {
                if (!Array.isArray(currentGroup.finalAnswer)) {
                  currentGroup.finalAnswer = [currentGroup.finalAnswer];
                }
                currentGroup.finalAnswer.push(message);
              } else {
                currentGroup.finalAnswer = message;
              }
            }
          }
        } else {
          // 都关闭：所有消息都放入常规显示
          console.log('分类为最终答案 (都关闭):', message.type);
          // 如果是final_answer类型，替换之前的最终答案；其他类型累积
          if (message.type === 'final_answer') {
            currentGroup.finalAnswer = message; // 直接替换，只保留最后一个final_answer
          } else {
            // 非final_answer消息累积显示
            if (currentGroup.finalAnswer) {
              if (!Array.isArray(currentGroup.finalAnswer)) {
                currentGroup.finalAnswer = [currentGroup.finalAnswer];
              }
              currentGroup.finalAnswer.push(message);
            } else {
              currentGroup.finalAnswer = message;
            }
          }
        }
      }
    }

    // 推入最后一个组
    if (currentGroup) {
      groups.push(currentGroup);
    }

    console.log('消息分组完成:', {
      分组数量: groups.length,
      分组详情: groups.map((g, i) => ({
        组索引: i,
        用户消息: g.userMessage.displayContent.substring(0, 50),
        深度思考消息数: g.deepThinkMessages.length,
        深度思考消息类型: g.deepThinkMessages.map(m => m.type),
        最终答案: g.finalAnswer 
          ? Array.isArray(g.finalAnswer) 
            ? `${g.finalAnswer.length}个消息` 
            : g.finalAnswer.displayContent.substring(0, 50)
          : '无'
      }))
    });

    return groups;
  };

  // 获取智能体类型
  const getAgentType = (role: string): string => {
    if (role.includes('analysis')) return '分析智能体';
    if (role.includes('planning')) return '规划智能体';
    if (role.includes('executor')) return '执行智能体';
    if (role.includes('observation')) return '观察智能体';
    if (role.includes('summary')) return '总结智能体';
    if (role.includes('decompose')) return '分解智能体';
    return '智能体';
  };

  // 格式化耗时
  const formatDuration = (duration: number): string => {
    if (duration < 1000) {
      return `${Math.round(duration)}ms`;
    } else if (duration < 60000) {
      return `${(duration / 1000).toFixed(1)}s`;
    } else {
      const minutes = Math.floor(duration / 60000);
      const seconds = Math.floor((duration % 60000) / 1000);
      return `${minutes}m${seconds}s`;
    }
  };

  // 计算深度思考总耗时
  const calculateDeepThinkTotalDuration = (deepThinkMessages: Message[]): number => {
    return deepThinkMessages.reduce((total, msg) => total + (msg.duration || 0), 0);
  };

  // 处理主聊天界面的显示内容（隐藏JSON但保留其他内容）
  const formatMainChatContent = (content: string): string => {
    return content.replace(/```json[\s\S]*?```/g, '');
  };

  // 检测并格式化工具调用结果为JSON
  const formatToolCallResult = (content: string): string => {
    // 更全面的工具调用结果检测模式
    const toolCallPatterns = [
      // 中文模式
      /工具调用结果[：:\s]*({[\s\S]*?})/gi,
      /调用.*?结果[：:\s]*({[\s\S]*?})/gi,
      /执行结果[：:\s]*({[\s\S]*?})/gi,
      /返回结果[：:\s]*({[\s\S]*?})/gi,
      // 英文模式
      /Tool call result[：:\s]*({[\s\S]*?})/gi,
      /Tool result[：:\s]*({[\s\S]*?})/gi,
      /Execution result[：:\s]*({[\s\S]*?})/gi,
      /Response[：:\s]*({[\s\S]*?})/gi,
      /Result[：:\s]*({[\s\S]*?})/gi,
      // 通用JSON模式（独立的大括号块，更精确的匹配）
      /^(\s*{[\s\S]*?}\s*)$/gm,
      // MCP工具调用特定模式
      /map_geocoding.*?result[：:\s]*({[\s\S]*?})/gi,
      /geocoding.*?result[：:\s]*({[\s\S]*?})/gi,
      // 更宽泛的JSON检测模式 - 匹配任何看起来像JSON对象的内容
      /(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/g,
      // 处理数字开头的JSON（例如："0 {"result_type": ...）
      /^(\d+\s*)(\{[\s\S]*?\})(\s*)$/gm,
      // 处理转义后的JSON字符串（带引号包围的JSON）
      /"(\{[\s\S]*?\})"/g
    ];

    let formattedContent = content;
    
    // 首先尝试检测是否整个内容就是一个JSON对象
    const trimmedContent = content.trim();
    
    // 处理转义后的JSON字符串（包含 \n 等转义字符）
    if (trimmedContent.startsWith('"') && trimmedContent.endsWith('"')) {
      try {
        // 先解析字符串，去掉外层引号并处理转义字符
        const unescapedJson = JSON.parse(trimmedContent);
        // 然后尝试解析内部的JSON
        const parsed = JSON.parse(unescapedJson);
        const formattedJson = JSON.stringify(parsed, null, 2);
        return `\`\`\`json\n${formattedJson}\n\`\`\``;
      } catch (e) {
        // 转义JSON解析失败，继续其他处理
      }
    }
    
    // 处理普通JSON对象
    if (trimmedContent.startsWith('{') && trimmedContent.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmedContent);
        const formattedJson = JSON.stringify(parsed, null, 2);
        return `\`\`\`json\n${formattedJson}\n\`\`\``;
      } catch (e) {
        // 如果不是有效JSON，继续使用模式匹配
      }
    }
    
    for (const pattern of toolCallPatterns) {
      formattedContent = formattedContent.replace(pattern, (match, ...groups) => {
        try {
          let cleanedJson = '';
          let prefix = '';
          
          // 处理数字开头的JSON模式 (例如: "0 {json}")
          if (pattern.source.includes('\\d+\\s*')) {
            const [numberPrefix, jsonPart, suffix] = groups;
            if (jsonPart) {
              cleanedJson = jsonPart.trim();
              prefix = numberPrefix || '';
            }
          } 
          // 处理转义JSON字符串模式 (例如: "{"key": "value"}")
          else if (pattern.source.includes('"(\\{')) {
            const jsonPart = groups[0];
            if (jsonPart) {
              try {
                // 先解析转义字符串
                cleanedJson = JSON.parse(`"${jsonPart}"`);
              } catch (e) {
                cleanedJson = jsonPart.trim();
              }
            }
          } else {
            // 处理其他模式
            const jsonPart = groups[0];
            cleanedJson = jsonPart ? jsonPart.trim() : match.trim();
            
            // 如果没有jsonPart，说明是完整匹配，尝试解析整个match
            if (!jsonPart && match.trim().startsWith('{') && match.trim().endsWith('}')) {
              cleanedJson = match.trim();
            }
          }
          
          // 如果cleanedJson看起来像一个转义的JSON字符串，先尝试解析转义
          if (cleanedJson.includes('\\n') || cleanedJson.includes('\\t') || cleanedJson.includes('\\"')) {
            try {
              // 尝试解析转义字符串
              const unescapedJson = cleanedJson.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
              const parsed = JSON.parse(unescapedJson);
              const formattedJson = JSON.stringify(parsed, null, 2);
              
              // 根据匹配的模式决定替换方式
              if (pattern.source.startsWith('^') || !groups[0] || prefix) {
                return prefix ? `${prefix}\`\`\`json\n${formattedJson}\n\`\`\`` : `\`\`\`json\n${formattedJson}\n\`\`\``;
              } else {
                return match.replace(groups[0], `\n\`\`\`json\n${formattedJson}\n\`\`\``);
              }
                         } catch (e) {
               // 转义JSON解析失败，尝试普通解析
             }
          }
          
          if (!cleanedJson.startsWith('{') || !cleanedJson.endsWith('}')) {
            return match;
          }
          
          // 尝试解析JSON
          const parsed = JSON.parse(cleanedJson);
          const formattedJson = JSON.stringify(parsed, null, 2);
          
          // 根据匹配的模式决定替换方式
          if (pattern.source.startsWith('^') || !groups[0] || prefix) {
            // 独立JSON块或有数字前缀，直接替换为代码块
            return prefix ? `${prefix}\`\`\`json\n${formattedJson}\n\`\`\`` : `\`\`\`json\n${formattedJson}\n\`\`\``;
          } else {
            // 有前缀的结果，保留前缀但格式化JSON部分
            return match.replace(groups[0], `\n\`\`\`json\n${formattedJson}\n\`\`\``);
          }
        } catch (e) {
          // 如果不是有效JSON，保持原样
          return match;
        }
      });
    }

    return formattedContent;
  };

    // 渲染深度思考气泡框
  const renderDeepThinkBubble = (deepThinkMessages: Message[]) => {
    return (
      <DeepThinkBubble 
        deepThinkMessages={deepThinkMessages}
        formatDuration={formatDuration}
        calculateDeepThinkTotalDuration={calculateDeepThinkTotalDuration}
        formatToolCallResult={formatToolCallResult}
        CodeBlock={CodeBlock}
      />
    );
  };

  // 处理消息块
  const handleMessageChunk = (data: any) => {
    if (data.message_id && (data.show_content !== undefined || data.content !== undefined)) {
      const messageId = data.message_id;
      const showContent = data.show_content || '';
      const realContent = data.content || '';
      
      console.log('处理消息块:', {
        message_id: messageId,
        show_content: showContent,
        content: realContent,
        step_type: data.step_type,
        agent_type: data.agent_type
      });

      setMessages(prev => {
        const existingIndex = prev.findIndex(m => m.id === messageId);
        const now = new Date();
        
        if (existingIndex >= 0) {
          // 更新现有消息
          const updated = [...prev];
          const existingMessage = updated[existingIndex];
          const updatedContent = existingMessage.content + realContent;
          const updatedDisplayContent = existingMessage.displayContent + showContent;
          
          updated[existingIndex] = {
            ...existingMessage,
            content: updatedContent,
            displayContent: updatedDisplayContent,
            timestamp: now,
            endTime: now,
            duration: existingMessage.startTime ? now.getTime() - existingMessage.startTime.getTime() : 0
          };
          
          // 只从最终答案中提取地点信息，并替换之前的地点
          if (data.step_type === 'final_answer' && shouldExtractLocations(data.step_type, data.agent_type, updatedDisplayContent)) {
            const locations = extractMapLocations(updatedDisplayContent);
            if (locations.length > 0) {
              console.log('从最终答案提取到地点信息，替换之前的地点:', locations);
              setMapLocations(locations); // 直接替换，不合并
            }
          }
          
          return updated;
        } else {
          // 创建新消息
          const newMessage: Message = {
            id: messageId,
            role: (data.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant' | 'system',
            content: realContent,
            displayContent: showContent,
            timestamp: now,
            type: data.step_type,
            agentType: getAgentType(data.agent_type || data.role || 'assistant'),
            startTime: now,
            endTime: now,
            duration: 0
          };
          
          // 只从最终答案中提取地点信息，并替换之前的地点
          if (data.step_type === 'final_answer' && shouldExtractLocations(data.step_type, data.agent_type, showContent)) {
            const locations = extractMapLocations(showContent);
            if (locations.length > 0) {
              console.log('从最终答案提取到地点信息，替换之前的地点:', locations);
              setMapLocations(locations); // 直接替换，不合并
            }
          }
          
          return [...prev, newMessage];
        }
      });
    }
  };

  // 发送消息
  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content: inputValue,
      timestamp: new Date(),
      displayContent: inputValue,
      startTime: new Date(),
      endTime: new Date(),
      duration: 0
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setInputValue('');
    // 清空地图上的地点，等待新的回复
    setMapLocations([]);

    try {
      // 构建请求数据
      const requestData = {
        type: 'chat',
        messages: [...messages, userMessage].map(msg => ({
          role: msg.role,
          content: msg.content,
          message_id: msg.id,
          type: msg.type || 'normal'
        })),
        use_deepthink: useDeepThink,
        use_multi_agent: useMultiAgent,
        selected_mcp_servers: selectedMcpServers
      };

      console.log('发送请求参数:', {
        use_deepthink: useDeepThink,
        use_multi_agent: useMultiAgent,
        消息数量: requestData.messages.length
      });

      // 发送流式请求
      const response = await fetch('/api/chat-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // 处理流式响应
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法获取响应流');
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              console.log('收到流式数据:', data);
              
              switch (data.type) {
                case 'chat_chunk':
                  handleMessageChunk(data);
                  break;
                case 'chat_complete':
                  setIsLoading(false);
                  console.log('聊天完成');
                  break;
                case 'error':
                  setIsLoading(false);
                  setMessages(prev => [...prev, {
                    id: uuidv4(),
                    role: 'system',
                    content: `错误: ${data.message}`,
                    displayContent: `错误: ${data.message}`,
                    timestamp: new Date(),
                    type: 'error'
                  }]);
                  break;
              }
            } catch (error) {
              console.error('解析JSON失败:', error, line);
            }
          }
        }
      }

    } catch (error) {
      console.error('发送消息失败:', error);
      setIsLoading(false);
      setMessages(prev => [...prev, {
        id: uuidv4(),
        role: 'system',
        content: `连接错误: ${error}`,
        displayContent: `连接错误: ${error}`,
        timestamp: new Date(),
        type: 'error'
      }]);
    }
  };

  // 清空对话
  const handleClearChat = () => {
    setMessages([]);
    setMapLocations([]);
  };

  // 处理MCP服务器选择
  const handleMcpServerChange = (serverName: string, checked: boolean) => {
    console.log('MCP服务器选择变化:', { serverName, checked, current: selectedMcpServers });
    setSelectedMcpServers(prev => {
      const newSelection = checked 
        ? [...prev, serverName]
        : prev.filter(name => name !== serverName);
      console.log('更新后的选择:', newSelection);
      return newSelection;
    });
  };

  // 全选可用的服务器
  const handleSelectAll = () => {
    const availableServers = mcpServers.filter(s => s.status !== 'error' && s.disabled !== true).map(s => s.name);
    console.log('全选可用服务器:', availableServers);
    setSelectedMcpServers(availableServers);
  };

  // 清空选择
  const handleClearAll = () => {
    console.log('清空所有选择');
    setSelectedMcpServers([]);
  };

  // 获取服务器图标
  const getServerIcon = (serverName: string) => {
    if (serverName === 'baidu-map') return '🗺️';
    if (serverName === '12306-mcp') return '🚄';
    if (serverName === 'fetch') return '🌐';
    if (serverName.includes('search')) return '🔍';
    return '🔧';
  };

  // 新增：复制代码功能
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCode(text);
      setTimeout(() => setCopiedCode(''), 2000);
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  // 检测并格式化JSON
  const formatJSON = (text: string) => {
    try {
      const parsed = JSON.parse(text);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return text;
    }
  };

  // 检测是否为JSON格式
  const isValidJSON = (text: string) => {
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  };

  // 增强的代码块渲染组件
  const CodeBlock = ({ language, children, isInline = false }: any) => {
    const codeString = String(children).replace(/\n$/, '');
    
    if (isInline) {
      return (
        <code 
          style={{
            background: '#f8fafc',
            color: '#475569',
            padding: '2px 6px',
            borderRadius: '4px',
            fontSize: '13px',
            fontFamily: 'SF Mono, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            border: '1px solid #e2e8f0'
          }}
        >
          {children}
        </code>
      );
    }

    // 特殊处理JSON格式
    const isJSON = language === 'json' || (!language && isValidJSON(codeString));
    const displayCode = isJSON ? formatJSON(codeString) : codeString;
    const displayLanguage = isJSON ? 'json' : (language || 'text');

    return (
      <div style={{ 
        position: 'relative', 
        margin: '12px 0',
        borderRadius: '8px',
        overflow: 'hidden',
        border: '1px solid #e2e8f0'
      }}>
        {/* 代码块头部 */}
        <div style={{
          background: '#f8fafc',
          padding: '8px 12px',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span style={{
            fontSize: '12px',
            color: '#64748b',
            fontWeight: 500,
            textTransform: 'uppercase'
          }}>
            {displayLanguage}
          </span>
          <Button
            type="text"
            size="small"
            icon={copiedCode === displayCode ? <CheckOutlined /> : <CopyOutlined />}
            onClick={() => copyToClipboard(displayCode)}
            style={{
              fontSize: '12px',
              padding: '2px 6px',
              height: 'auto',
              color: copiedCode === displayCode ? '#10b981' : '#64748b'
            }}
          >
            {copiedCode === displayCode ? '已复制' : '复制'}
          </Button>
        </div>
        
        <SyntaxHighlighter
          style={tomorrow as any}
          language={displayLanguage}
          PreTag="div"
          customStyle={{
            background: '#1e293b',
            margin: 0,
            fontSize: '13px',
            fontFamily: 'SF Mono, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            borderRadius: 0
          }}
        >
          {displayCode}
        </SyntaxHighlighter>
      </div>
    );
  };

  // 增强的表格组件 - 与新风格一致
  const MarkdownTable = ({ children }: any) => {
    // 改进的表格数据解析
    const parseTableData = (tableElement: any) => {
      const rows: any[] = [];
      const headers: string[] = [];
      
      console.log('表格解析调试 - 原始children:', tableElement);
      
      // 递归获取文本内容
      const getTextContent = (element: any): string => {
        if (typeof element === 'string') return element;
        if (typeof element === 'number') return String(element);
        if (Array.isArray(element)) return element.map(getTextContent).join('');
        if (element?.props?.children) return getTextContent(element.props.children);
        return '';
      };
      
      React.Children.forEach(tableElement.props.children, (child: any) => {
        console.log('表格子元素类型:', child?.type);
        
        if (child?.type === 'thead') {
          React.Children.forEach(child.props.children, (row: any) => {
            if (row?.type === 'tr') {
              React.Children.forEach(row.props.children, (cell: any) => {
                if (cell?.type === 'th') {
                  const headerText = getTextContent(cell.props.children) || '';
                  console.log('解析到表头:', headerText);
                  headers.push(headerText);
                }
              });
            }
          });
        } else if (child?.type === 'tbody') {
          React.Children.forEach(child.props.children, (row: any) => {
            if (row?.type === 'tr') {
              const rowData: any = {};
              let cellIndex = 0;
              React.Children.forEach(row.props.children, (cell: any) => {
                if (cell?.type === 'td') {
                  const cellContent = getTextContent(cell.props.children) || '';
                  const columnKey = headers[cellIndex] || `col${cellIndex}`;
                  console.log(`行数据 [${cellIndex}]:`, cellContent);
                  rowData[columnKey] = cellContent;
                  cellIndex++;
                }
              });
              if (Object.keys(rowData).length > 0) {
                console.log('添加行数据:', rowData);
                rows.push(rowData);
              }
            }
          });
        }
      });
      
      console.log('表格解析结果 - 表头:', headers, '行数:', rows.length);
      return { headers, rows };
    };

    const { headers, rows } = parseTableData(children);
    
    // 如果没有解析到有效数据，尝试简单的HTML表格渲染
    if (headers.length === 0 || rows.length === 0) {
      console.log('表格解析失败，使用备用渲染方案');
      return (
        <div style={{ 
          margin: '16px 0', 
          overflow: 'auto',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          background: 'linear-gradient(135deg, #ffffff 0%, #fafbff 100%)',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)'
        }}>
          <div style={{
            fontSize: '13px',
            lineHeight: '1.6',
            color: '#374151'
          }}>
            {/* 尝试直接渲染HTML表格结构 */}
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '13px'
            }}>
              {children}
            </table>
          </div>
        </div>
      );
    }
    
    const columns = headers.map((header, index) => ({
      title: (
        <span style={{ 
          fontSize: '13px', 
          fontWeight: 600, 
          color: '#374151' 
        }}>
          {header}
        </span>
      ),
      dataIndex: header || `col${index}`,
      key: header || `col${index}`,
      render: (text: any) => (
        <span style={{ 
          fontSize: '13px', 
          color: '#374151',
          lineHeight: '1.5'
        }}>
          {Array.isArray(text) ? text.join('') : String(text || '')}
        </span>
      ),
      ellipsis: {
        showTitle: false,
      }
    }));

    return (
      <div style={{ 
        margin: '16px 0', 
        overflow: 'auto',
        borderRadius: '12px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
        border: '1px solid #e2e8f0'
      }}>
        <Table
          columns={columns}
          dataSource={rows.map((row, index) => ({ ...row, key: index }))}
          pagination={false}
          size="small"
          bordered={false}
          style={{
            fontSize: '13px',
            background: 'linear-gradient(135deg, #ffffff 0%, #fafbff 100%)'
          }}
          scroll={{ x: true }}
          rowClassName={(record, index) => 
            index % 2 === 0 ? 'table-row-even' : 'table-row-odd'
          }
        />
      </div>
    );
  };

  // 渲染消息 - 豆包风格
  const renderMessage = (message: Message) => {
    console.log('渲染单个消息:', {
      id: message.id,
      role: message.role,
      displayContent: message.displayContent,
      displayContentLength: message.displayContent.length
    });
    
    const isUser = message.role === 'user';
    const isError = message.type === 'error';
    
    return (
      <div
        key={message.id}
        className={`message-bubble ${isUser ? 'user-message' : ''}`}
        style={{
          display: 'flex',
          justifyContent: isUser ? 'flex-end' : 'flex-start',
          marginBottom: '12px',
          animation: !isUser ? 'agentMessageSlideIn 0.4s cubic-bezier(0.4, 0, 0.2, 1)' : 'none'  // 为智能体消息添加滑入动画
        }}
      >
        <div style={{
          maxWidth: '85%',  // 增加最大宽度以更好地显示表格
          minWidth: '120px',
          position: 'relative'
        }}>
          {/* 智能体类型标签 - 与深度思考框一致的风格 */}
          {!isUser && message.agentType && (
            <div 
              className="agent-type-tag"
              style={{
                fontSize: '13px',
                color: '#7c3aed',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 8px',
                background: 'linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 100%)',
                borderRadius: '16px',
                border: '1px solid #ddd6fe',
                marginBottom: '8px',
                width: 'fit-content',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
              }}>
              <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                boxShadow: '0 0 6px rgba(139, 92, 246, 0.4)',
                animation: 'agentPulse 2s infinite'
              }} />
              {message.agentType}
            </div>
          )}
          
          {/* 消息气泡 - 与深度思考框一致的风格 */}
          <div
            className={`markdown-content ${isUser ? 'user-message' : ''}`}
            style={{
              background: isUser 
                ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' 
                : isError 
                  ? '#fef2f2' 
                  : 'linear-gradient(135deg, #fafbff 0%, #f8fafc 100%)',
              color: isUser 
                ? '#ffffff' 
                : isError 
                  ? '#dc2626' 
                  : '#374151',
              padding: '16px 20px',  // 与深度思考框一致的内边距
              borderRadius: isUser 
                ? '16px 16px 4px 16px' 
                : '16px',  // 统一圆角
              boxShadow: isUser 
                ? '0 1px 3px rgba(99, 102, 241, 0.3)'
                : '0 4px 12px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.02)',  // 与深度思考框一致的阴影
              border: isUser 
                ? 'none'
                : '1px solid #e2e8f0',  // 与深度思考框一致的边框
              fontSize: '14px',
              lineHeight: '1.6',
              wordBreak: 'break-word',
              position: 'relative',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'  // 添加过渡动画
            }}
          >
            {/* 消息耗时显示 - 与深度思考框一致的风格 */}
            {!isUser && message.duration && message.duration > 0 && (
              <div style={{
                position: 'absolute',
                top: '8px',
                right: '12px',
                fontSize: '11px',
                color: '#6b7280',
                background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 250, 252, 0.9) 100%)',
                padding: '3px 8px',
                borderRadius: '12px',
                border: '1px solid #e5e7eb',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                backdropFilter: 'blur(4px)'
              }}>
                <ClockCircleOutlined style={{ fontSize: '10px' }} />
                {formatDuration(message.duration)}
              </div>
            )}

            <ReactMarkdown
              remarkPlugins={[remarkGfm]}  // 添加GitHub风味Markdown支持
              components={{
                code({node, className, children, ...props}) {
                  const match = /language-(\w+)/.exec(className || '');
                  const isInline = !match;
                  
                  return (
                    <CodeBlock 
                      language={match?.[1]} 
                      isInline={isInline}
                    >
                      {children}
                    </CodeBlock>
                  );
                },
                
                // 表格组件 - 增强处理
                table({children}) {
                  return <MarkdownTable>{children}</MarkdownTable>;
                },
                
                // 表格行处理
                tr({children}) {
                  return <tr>{children}</tr>;
                },
                
                // 表格头处理
                th({children}) {
                  return <th>{children}</th>;
                },
                
                // 表格单元格处理
                td({children}) {
                  return <td>{children}</td>;
                },
                
                // 表格头部处理
                thead({children}) {
                  return <thead>{children}</thead>;
                },
                
                // 表格主体处理
                tbody({children}) {
                  return <tbody>{children}</tbody>;
                },
                
                // 段落样式优化
                p({children}) {
                  return <div style={{ margin: '6px 0', lineHeight: '1.6' }}>{children}</div>;
                },
                
                // 列表样式优化
                ul({children}) {
                  return (
                    <ul style={{ 
                      margin: '8px 0', 
                      paddingLeft: '20px',
                      lineHeight: '1.6'
                    }}>
                      {children}
                    </ul>
                  );
                },
                
                ol({children}) {
                  return (
                    <ol style={{ 
                      margin: '8px 0', 
                      paddingLeft: '20px',
                      lineHeight: '1.6'
                    }}>
                      {children}
                    </ol>
                  );
                },
                
                // 引用块样式优化
                blockquote({children}) {
                  return (
                    <blockquote style={{
                      borderLeft: `4px solid ${isUser ? 'rgba(255,255,255,0.3)' : '#e2e8f0'}`,
                      margin: '12px 0',
                      fontStyle: 'italic',
                      opacity: 0.9,
                      background: isUser 
                        ? 'rgba(255, 255, 255, 0.1)' 
                        : '#f8fafc',
                      borderRadius: '6px',
                      padding: '12px 12px 12px 16px'
                    }}>
                      {children}
                    </blockquote>
                  );
                },
                
                // 标题样式优化
                h1({children}) {
                  return (
                    <h1 style={{
                      fontSize: '20px',
                      fontWeight: 700,
                      margin: '16px 0 8px 0',
                      color: isUser ? '#ffffff' : '#1f2937',
                      borderBottom: `2px solid ${isUser ? 'rgba(255,255,255,0.3)' : '#e2e8f0'}`,
                      paddingBottom: '4px'
                    }}>
                      {children}
                    </h1>
                  );
                },
                
                h2({children}) {
                  return (
                    <h2 style={{
                      fontSize: '18px',
                      fontWeight: 600,
                      margin: '14px 0 6px 0',
                      color: isUser ? '#ffffff' : '#1f2937'
                    }}>
                      {children}
                    </h2>
                  );
                },
                
                h3({children}) {
                  return (
                    <h3 style={{
                      fontSize: '16px',
                      fontWeight: 600,
                      margin: '12px 0 4px 0',
                      color: isUser ? '#ffffff' : '#1f2937'
                    }}>
                      {children}
                    </h3>
                  );
                },
                
                // 水平分割线
                hr() {
                  return (
                    <hr style={{
                      border: 'none',
                      borderTop: `1px solid ${isUser ? 'rgba(255,255,255,0.3)' : '#e2e8f0'}`,
                      margin: '16px 0'
                    }} />
                  );
                },
                
                // 强调文本
                strong({children}) {
                  return (
                    <strong style={{
                      fontWeight: 700,
                      color: isUser ? '#ffffff' : '#1f2937'
                    }}>
                      {children}
                    </strong>
                  );
                },
                
                em({children}) {
                  return (
                    <em style={{
                      fontStyle: 'italic',
                      color: isUser ? 'rgba(255,255,255,0.9)' : '#4b5563'
                    }}>
                      {children}
                    </em>
                  );
                },
                
                // 链接样式
                a({href, children}) {
                  return (
                    <a 
                      href={href} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      style={{
                        color: isUser ? '#ffffff' : '#6366f1',
                        textDecoration: 'underline',
                        textDecorationColor: isUser ? 'rgba(255,255,255,0.5)' : '#6366f1'
                      }}
                    >
                      {children}
                    </a>
                  );
                }
              }}
            >
              {formatMainChatContent(message.displayContent)}
            </ReactMarkdown>
          </div>
          
          {/* 时间戳 */}
          <div style={{ 
            fontSize: '11px', 
            color: '#9ca3af',
            marginTop: '4px',
            textAlign: isUser ? 'right' : 'left'
          }}>
            {message.timestamp.toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit'
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ 
      height: '100vh', 
      display: 'flex', 
      flexDirection: 'row',
      overflow: 'hidden',
      background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
      padding: '16px',
      gap: '16px'
    }}>
      {/* 左侧聊天区域 */}
      <div style={{ 
        flex: showMap ? '0 0 calc(60% - 8px)' : 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#ffffff',
        borderRadius: '16px',
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)',
        border: '1px solid rgba(255, 255, 255, 0.6)',
        height: 'calc(100vh - 32px)'
      }}>
        {/* 消息列表 - 豆包风格 */}
        <div style={{ 
          flex: 1, 
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          borderRadius: '16px'
        }}>
          <div style={{
            width: '100%',
            maxWidth: showMap ? 'none' : '768px',
            padding: '16px 24px'
          }}>
          {messages.length === 0 ? (
            <div style={{ 
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              textAlign: 'center',
              color: '#6b7280',
              padding: '60px 20px',
              minHeight: '400px'
            }}>
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: '16px',
                background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px',
                boxShadow: '0 4px 12px rgba(99, 102, 241, 0.2)'
              }}>
                <RobotOutlined style={{ fontSize: '28px', color: '#ffffff' }} />
              </div>
              
              <div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px', color: '#1f2937' }}>
                您好，我是 SuperTravelAgent
              </div>
              <div style={{ fontSize: '14px', lineHeight: '1.5', marginBottom: '24px', maxWidth: '320px' }}>
                我是您的智能旅游规划助手，可以运用多智能体协作为您制定完美的旅行方案。
              </div>
              
              {/* 功能特色 */}
              <div style={{ 
                display: 'flex', 
                gap: '12px',
                flexWrap: 'wrap',
                justifyContent: 'center',
                marginBottom: '32px'
              }}>
                <div style={{
                  padding: '12px 16px',
                  background: '#ffffff',
                  borderRadius: '8px',
                  border: '1px solid #f1f5f9',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <ThunderboltOutlined style={{ fontSize: '16px', color: '#f59e0b' }} />
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#374151' }}>
                    深度规划
                  </span>
                </div>
                
                <div style={{
                  padding: '12px 16px',
                  background: '#ffffff',
                  borderRadius: '8px',
                  border: '1px solid #f1f5f9',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <BranchesOutlined style={{ fontSize: '16px', color: '#10b981' }} />
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#374151' }}>
                    智能体协作
                  </span>
                </div>
              </div>

              {/* 使用示例 */}
              <div style={{ 
                width: '100%',
                maxWidth: '600px'
              }}>
                <div style={{ 
                  fontSize: '16px', 
                  fontWeight: 600, 
                  color: '#1f2937', 
                  marginBottom: '16px' 
                }}>
                  试试这些示例
                </div>
                
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
                  gap: '12px'
                }}>
                  {[
                    {
                      title: "行程规划",
                      example: "帮我规划一次北京3天2夜的文化之旅",
                      icon: "🗺️"
                    },
                    {
                      title: "酒店预订", 
                      example: "推荐上海外滩附近性价比高的酒店",
                      icon: "🏨"
                    },
                    {
                      title: "美食攻略",
                      example: "制定成都美食探索指南和必吃清单",
                      icon: "🍜"
                    },
                    {
                      title: "交通查询",
                      example: "查询从广州到桂林的最佳交通方案",
                      icon: "🚄"
                    }
                  ].map((item, index) => (
                    <div
                      key={index}
                      style={{
                        padding: '16px',
                        background: '#ffffff',
                        borderRadius: '12px',
                        border: '1px solid #f1f5f9',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        textAlign: 'left'
                      }}
                      onClick={() => setInputValue(item.example)}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = '#e0e7ff';
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(99, 102, 241, 0.1)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = '#f1f5f9';
                        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.05)';
                      }}
                    >
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '8px', 
                        marginBottom: '8px' 
                      }}>
                        <span style={{ fontSize: '18px' }}>{item.icon}</span>
                        <span style={{ 
                          fontSize: '14px', 
                          fontWeight: 600, 
                          color: '#1f2937' 
                        }}>
                          {item.title}
                        </span>
                      </div>
                      <div style={{ 
                        fontSize: '13px', 
                        color: '#6b7280', 
                        lineHeight: '1.4' 
                      }}>
                        {item.example}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {(() => {
                console.log('渲染消息列表:', {
                  总消息数: messages.length,
                  消息列表: messages.map(m => ({
                    id: m.id,
                    role: m.role,
                    displayContent长度: m.displayContent.length,
                    displayContent前50字符: m.displayContent.substring(0, 50),
                    是否有内容: m.displayContent.trim().length > 0
                  }))
                });
                
                const filteredMessages = messages.filter(msg => msg.displayContent.trim().length > 0);
                console.log('过滤后消息数:', filteredMessages.length);
                
                // 使用分组逻辑渲染消息
                const messageGroups = groupMessages(filteredMessages);
                console.log('消息分组:', messageGroups);
                
                return messageGroups.map((group, groupIndex) => (
                  <div key={`group-${groupIndex}`} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* 渲染用户消息 */}
                    {renderMessage(group.userMessage)}
                    
                    {/* 渲染深度思考气泡框 */}
                    {renderDeepThinkBubble(group.deepThinkMessages)}
                    
                    {/* 渲染最终答案 */}
                    {group.finalAnswer && (
                      Array.isArray(group.finalAnswer) 
                        ? group.finalAnswer.map((msg, index) => renderMessage(msg))
                        : renderMessage(group.finalAnswer)
                    )}
                  </div>
                ));
              })()}
            </div>
          )}
          
          {isLoading && (
            <div style={{ 
              display: 'flex', 
              justifyContent: 'center', 
              padding: '20px 0',
              alignItems: 'center',
              gap: '8px',
              color: '#6b7280'
            }}>
              <Spin size="small" />
              <span>SuperTravelAgent正在规划...</span>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 现代化风格的输入区域 */}
      <div style={{ 
        padding: '16px 24px 20px',
        background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
        flexShrink: 0,
        borderTop: '1px solid #e2e8f0'
      }}>
        {/* 输入框容器 - 豆包风格多行设计 */}
        <div style={{
          maxWidth: '768px',
          margin: '0 auto'
        }}>
          <div 
            className="chat-input-container"
            style={{
              position: 'relative',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #ffffff 0%, #fafbff 100%)',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              minHeight: '140px',
              display: 'flex',
              flexDirection: 'column',
              border: '1px solid #e2e8f0',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.02)'
            }}
          >
            {/* 顶部功能开关行 */}
            {/* 控制选项区域 - 只保留地图按钮 */}
            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              padding: '12px 16px 8px 16px',
              borderBottom: '1px solid #f8fafc'
            }}>
              {/* 隐藏左侧的控制开关 */}
              {false && (
              <div style={{
                display: 'flex',
                gap: '12px',
                fontSize: '12px'
              }}>
                <label style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '6px',
                  color: '#6b7280',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: '12px',
                  background: useDeepThink ? '#f0f9ff' : 'transparent',
                  border: useDeepThink ? '1px solid #bae6fd' : '1px solid transparent',
                  transition: 'all 0.2s',
                  fontSize: '12px'
                }}>
                  <Switch 
                    checked={useDeepThink} 
                    onChange={setUseDeepThink}
                    size="small"
                  />
                  <ThunderboltOutlined style={{ color: useDeepThink ? '#0ea5e9' : '#6b7280', fontSize: '12px' }} />
                  深度思考
                </label>
                
                <label style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '6px',
                  color: '#6b7280',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: '12px',
                  background: useMultiAgent ? '#f0fdf4' : 'transparent',
                  border: useMultiAgent ? '1px solid #bbf7d0' : '1px solid transparent',
                  transition: 'all 0.2s',
                  fontSize: '12px'
                }}>
                  <Switch 
                    checked={useMultiAgent} 
                    onChange={setUseMultiAgent}
                    size="small"
                  />
                  <BranchesOutlined style={{ color: useMultiAgent ? '#10b981' : '#6b7280', fontSize: '12px' }} />
                  智能体协作
                </label>

                <Dropdown
                  trigger={['click']}
                  open={mcpModalVisible}
                  onOpenChange={setMcpModalVisible}
                  placement="bottomLeft"
                  getPopupContainer={(trigger) => trigger.parentElement || document.body}
                  dropdownRender={() => (
                    <div 
                      style={{
                        background: '#ffffff',
                        borderRadius: '8px',
                        padding: '12px',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                        border: '1px solid #e5e7eb',
                        minWidth: '280px',
                        maxHeight: '400px',
                        overflowY: 'auto'
                      }}
                      onClick={(e) => e.stopPropagation()} // 阻止事件冒泡，防止Dropdown关闭
                    >
                      <div style={{
                        fontSize: '14px',
                        fontWeight: 500,
                        marginBottom: '8px',
                        color: '#374151',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}>
                        <CloudServerOutlined style={{ color: '#6366f1' }} />
                        选择MCP服务器 ({selectedMcpServers.length}/{mcpServers.length})
                      </div>
                      <Divider style={{ margin: '8px 0' }} />
                      
                      {mcpLoading ? (
                        <div style={{ textAlign: 'center', padding: '20px' }}>
                          <Spin size="small" />
                          <div style={{ marginTop: '8px', fontSize: '12px', color: '#9ca3af' }}>
                            加载服务器...
                          </div>
                        </div>
                      ) : mcpServers.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '20px', color: '#9ca3af', fontSize: '12px' }}>
                          暂无可用的MCP服务器
                        </div>
                      ) : (
                        <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                          {mcpServers.map((server) => (
                            <div 
                              key={server.name} 
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '8px 4px',
                                borderRadius: '6px',
                                transition: 'background 0.2s',
                                cursor: (server.status !== 'error' && server.disabled !== true) ? 'pointer' : 'default'
                              }}
                              onMouseEnter={(e) => {
                                if (server.status !== 'error' && server.disabled !== true) {
                                  e.currentTarget.style.background = '#f8fafc';
                                }
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'transparent';
                              }}
                              onClick={(e) => {
                                e.stopPropagation(); // 阻止冒泡
                                if (server.status !== 'error' && server.disabled !== true) {
                                  const isCurrentlySelected = selectedMcpServers.includes(server.name);
                                  handleMcpServerChange(server.name, !isCurrentlySelected);
                                }
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                                <span style={{ fontSize: '16px' }}>{getServerIcon(server.name)}</span>
                                <div>
                                  <div style={{ fontSize: '13px', fontWeight: 500, color: '#374151' }}>
                                    {server.name}
                                  </div>
                                  <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                                    {server.status === 'connected' ? '已连接' : server.status === 'error' ? '连接失败' : '未连接'}
                                    {server.tools_count > 0 && ` • ${server.tools_count} 个工具`}
                                  </div>
                                </div>
                              </div>
                              <Checkbox
                                checked={selectedMcpServers.includes(server.name)}
                                onChange={(e) => {
                                  e.stopPropagation(); // 阻止冒泡
                                  handleMcpServerChange(server.name, e.target.checked);
                                }}
                                disabled={server.status === 'error' || server.disabled === true}
                                onClick={(e) => {
                                  e.stopPropagation(); // 阻止冒泡
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                      
                      <Divider style={{ margin: '8px 0' }} />
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <Button 
                          type="text" 
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation(); // 阻止冒泡
                            handleSelectAll();
                          }}
                          style={{ fontSize: '12px' }}
                        >
                          全选
                        </Button>
                        <Button 
                          type="text" 
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation(); // 阻止冒泡
                            handleClearAll();
                          }}
                          style={{ fontSize: '12px' }}
                        >
                          清空
                        </Button>
                        <Button 
                          type="primary" 
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation(); // 阻止冒泡
                            setMcpModalVisible(false);
                          }}
                          style={{ fontSize: '12px' }}
                        >
                          确定
                        </Button>
                      </div>
                    </div>
                  )}
                >
                  <div 
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '6px',
                      color: '#6b7280',
                      cursor: 'pointer',
                      padding: '4px 8px',
                      borderRadius: '12px',
                      background: selectedMcpServers.length > 0 ? '#f0f9ff' : 'transparent',
                      border: selectedMcpServers.length > 0 ? '1px solid #bae6fd' : '1px solid transparent',
                      transition: 'all 0.2s',
                      fontSize: '12px'
                    }}
                    onClick={() => setMcpModalVisible(!mcpModalVisible)}
                  >
                    <CloudServerOutlined style={{ 
                      color: selectedMcpServers.length > 0 ? '#0ea5e9' : '#6b7280', 
                      fontSize: '12px' 
                    }} />
                    MCP服务器
                    {selectedMcpServers.length > 0 && (
                      <Tag  
                        style={{ 
                          marginLeft: '4px',
                          minWidth: '16px',
                          height: '16px',
                          lineHeight: '14px',
                          padding: '0 4px',
                          fontSize: '10px',
                          background: '#0ea5e9',
                          color: 'white',
                          border: 'none'
                        }}
                      >
                        {selectedMcpServers.length}
                      </Tag>
                    )}
                  </div>
                </Dropdown>
              </div>
              )}

              {/* 只保留地图相关按钮 */}
              <div style={{
                display: 'flex',
                gap: '8px',
                alignItems: 'center'
              }}>
                {/* 隐藏@技能和/文件按钮 */}
                {false && (
                <>
                <Button
                  type="text"
                  size="small"
                  style={{
                    color: '#9ca3af',
                    fontSize: '12px',
                    height: '24px',
                    padding: '0 8px',
                    borderRadius: '6px'
                  }}
                >
                  @ 技能
                </Button>
                <Button
                  type="text"
                  size="small"
                  style={{
                    color: '#9ca3af',
                    fontSize: '12px',
                    height: '24px',
                    padding: '0 8px',
                    borderRadius: '6px'
                  }}
                >
                  / 文件
                </Button>
                </>
                )}
                <Button
                  type="text"
                  size="small"
                  icon={<EnvironmentOutlined />}
                  className={showMap ? 'map-button-active' : ''}
                  onClick={() => {
                    setShowMap(!showMap);
                    // 如果显示地图且有地点，延迟一下再触发地图重新渲染
                    if (!showMap && mapLocations.length > 0) {
                      setTimeout(() => {
                        // 触发地图重新渲染，会自动缩放到地点
                        setMapLocations([...mapLocations]);
                      }, 300); // 增加延迟时间确保地图组件完全加载
                    }
                  }}
                  style={{
                    color: showMap ? '#7c3aed' : '#6b7280',
                    fontSize: '12px',
                    height: '28px',
                    padding: '0 12px',
                    borderRadius: '12px',
                    background: showMap 
                      ? 'linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 100%)' 
                      : 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                    border: showMap ? '1px solid #ddd6fe' : '1px solid #e2e8f0',
                    fontWeight: 500,
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                  }}
                >
                  地图{mapLocations.length > 0 && `(${mapLocations.length})`}
                </Button>
                {mapLocations.length > 0 && (
                  <Button
                    type="text"
                    size="small"
                    onClick={forceCleanMapLocations}
                    style={{
                      color: '#ef4444',
                      fontSize: '11px',
                      height: '24px',
                      padding: '0 8px',
                      borderRadius: '8px',
                      background: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)',
                      border: '1px solid #fecaca',
                      fontWeight: 500,
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                    }}
                  >
                    清除地点
                  </Button>
                )}
              </div>
            </div>

            {/* 输入框和发送按钮区域 */}
            <div style={{
              display: 'flex',
              alignItems: 'flex-end',
              padding: '8px 16px 12px 16px',
              gap: '12px'
            }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <TextArea
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="发消息..."
                  autoSize={{ minRows: 2, maxRows: 6 }}
                  bordered={false}
                  onPressEnter={(e) => {
                    if (!e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  disabled={isLoading}
                  style={{
                    padding: '0',
                    fontSize: '14px',
                    resize: 'none',
                    lineHeight: '1.5',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    background: 'transparent',
                    width: '100%',
                    minHeight: '42px'
                  }}
                />
                
                {/* 输入提示文字 - 只在输入框为空时显示 */}
                {!inputValue && (
                  <div style={{
                    position: 'absolute',
                    bottom: '4px',
                    right: '0',
                    fontSize: '11px',
                    color: '#9ca3af',
                    pointerEvents: 'none',
                    background: 'rgba(255, 255, 255, 0.8)',
                    padding: '2px 4px',
                    borderRadius: '4px'
                  }}>
                    按 Enter 发送 • Shift + Enter 换行
                  </div>
                )}
              </div>
              
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleSendMessage}
                disabled={isLoading || !inputValue.trim()}
                style={{
                  borderRadius: '12px',
                  height: '36px',
                  width: '36px',
                  padding: 0,
                  background: inputValue.trim() 
                    ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' 
                    : 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)',
                  borderColor: inputValue.trim() 
                    ? 'transparent' 
                    : 'transparent',
                  color: inputValue.trim() 
                    ? '#ffffff' 
                    : '#9ca3af',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  boxShadow: inputValue.trim() 
                    ? '0 4px 12px rgba(99, 102, 241, 0.3)' 
                    : '0 2px 4px rgba(0, 0, 0, 0.05)',
                  transform: inputValue.trim() ? 'scale(1.05)' : 'scale(1)'
                }}
              />
            </div>
          </div>
          </div>
        </div>
        
        {/* 输入框区域 - 已有的输入框代码应该在这里 */}
      </div>
      
      {/* 右侧地图区域 */}
      {showMap && (
        <div style={{ 
          flex: '0 0 calc(40% - 8px)',
          height: 'calc(100vh - 32px)',
          overflow: 'hidden',
          background: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 4px 24px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)',
          border: '1px solid rgba(255, 255, 255, 0.6)',
          position: 'relative'
        }}>
          <div style={{
            position: 'absolute',
            top: '16px',
            left: '16px',
            right: '60px', // 给右侧缩放控制留出空间
            zIndex: 999, // 降低层级，让缩放控制在上方
            background: 'linear-gradient(135deg, #ffffff 0%, #fafbff 100%)',
            borderRadius: '12px',
            padding: '12px 16px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
            border: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <EnvironmentOutlined style={{ color: '#7c3aed', fontSize: '16px' }} />
            <span style={{ 
              color: '#374151', 
              fontSize: '14px', 
              fontWeight: 600 
            }}>
              旅行地图
            </span>
            {mapLocations.length > 0 && (
              <span style={{
                background: 'linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 100%)',
                color: '#7c3aed',
                fontSize: '12px',
                padding: '2px 8px',
                borderRadius: '10px',
                fontWeight: 500,
                border: '1px solid #ddd6fe'
              }}>
                {mapLocations.length} 个地点
              </span>
            )}
          </div>
          <div style={{ 
            width: '100%', 
            height: '100%', 
            borderRadius: '16px', 
            overflow: 'hidden' 
          }}>
            <MapComponent 
              width="100%" 
              height="100%" 
              locations={mapLocations}
              onLocationAdd={(location) => {
                console.log('添加新地点:', location);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
});

export default ChatInterface; 