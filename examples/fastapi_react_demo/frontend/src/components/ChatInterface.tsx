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
  EnvironmentOutlined
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
  
  // MCP服务器相关状态
  const [mcpServers, setMcpServers] = useState<any[]>([]);
  const [selectedMcpServers, setSelectedMcpServers] = useState<string[]>([]);
  const [mcpModalVisible, setMcpModalVisible] = useState(false);
  const [mcpLoading, setMcpLoading] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<any>(null);

  // 新增：复制代码功能
  const [copiedCode, setCopiedCode] = useState<string>('');

  // 从消息内容中提取地点信息
  const extractMapLocations = (content: string) => {
    const locations: LocationPoint[] = [];
    
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
    
    try {
      // 方法1: 查找完整的JSON格式
      const fullJsonRegex = /\{[\s\S]*?"map_locations"[\s\S]*?\[[\s\S]*?\][\s\S]*?\}/g;
      let matches = content.match(fullJsonRegex);
      
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
                    lat: parseFloat(loc.lat.toString()),
                    lng: parseFloat(loc.lng.toString()),
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
                      lat: parseFloat(loc.lat.toString()),
                      lng: parseFloat(loc.lng.toString()),
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
      
      if (matches) {
        matches.forEach(match => {
          try {
            const locationsStr = `[${match.split('[')[1].split(']')[0]}]`;
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
                    lat: parseFloat(loc.lat.toString()),
                    lng: parseFloat(loc.lng.toString()),
                    description: loc.description || '',
                    category: category
                  });
                }
              }
            });
          } catch (error) {
            console.log('直接数组解析失败:', error);
          }
        });
      }
      
      console.log('提取到的地点数量:', locations.length);
      return locations;
    } catch (error) {
      console.error('解析地点信息失败:', error);
      return [];
    }
  };

  // 修复常见的JSON格式错误
  const fixJsonFormat = (jsonStr: string): string => {
    let fixed = jsonStr;
    
    // 修复缺失的逗号（数字后跟字符串）
    fixed = fixed.replace(/(\d+)(\s+)(")/g, '$1,$2$3');
    // 修复缺失的逗号（字符串后跟字符串）
    fixed = fixed.replace(/("[\w\s\u4e00-\u9fa5]+")(\s+)(")/g, '$1,$2$3');
    // 修复缺失的逗号（在}后跟{）
    fixed = fixed.replace(/(\})(\s*)(\{)/g, '$1,$2$3');
    
    // 修复末尾多余的逗号
    fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
    
    // 修复属性名缺少引号
    fixed = fixed.replace(/(\w+):/g, '"$1":');
    
    // 修复类别值缺少引号
    fixed = fixed.replace(/"category":\s*([^",}\]]+)/g, '"category": "$1"');
    
    return fixed;
  };

  // 尝试从部分JSON中提取地点信息
  const tryExtractPartialLocations = (content: string, locations: LocationPoint[]) => {
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
            lat: parseFloat(lat),
            lng: parseFloat(lng),
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
      console.log('ChatInterface - startNewChat方法被调用');
      console.log('ChatInterface - 当前消息数量:', messages.length);
      setMessages([]);
      console.log('ChatInterface - 消息已清空');
      setSessionId(uuidv4());
      console.log('ChatInterface - 新的sessionId已生成');
      setInputValue('');
      console.log('ChatInterface - 输入框已清空');
      setIsLoading(false);
      setMapLocations([]);
      console.log('ChatInterface - loading状态和地图位置已重置');
    },
    loadChat: (chatMessages: ChatHistoryItem['messages']) => {
      const mappedMessages = chatMessages.map(msg => ({
        ...msg,
        timestamp: new Date(msg.timestamp)
      }));
      setMessages(mappedMessages);
      setInputValue('');
      setIsLoading(false);
      
      // 从历史消息中提取地点信息
      const allLocations: LocationPoint[] = [];
      mappedMessages.forEach(msg => {
        if (msg.role === 'assistant' && shouldExtractLocations(msg.type || '', msg.agentType || '', msg.displayContent)) {
          const locations = extractMapLocations(msg.displayContent);
          locations.forEach(loc => {
            const exists = allLocations.find(existing => existing.name === loc.name);
            if (!exists) {
              allLocations.push(loc);
            }
          });
        }
      });
      
      if (allLocations.length > 0) {
        console.log('从历史消息中提取到地点信息:', allLocations);
        setMapLocations(allLocations);
      } else {
        setMapLocations([]);
      }
    }
  }));

  // 当加载的消息改变时，更新当前消息
  useEffect(() => {
    if (loadedMessages) {
      const mappedMessages = loadedMessages.map(msg => ({
        ...msg,
        timestamp: new Date(msg.timestamp)
      }));
      setMessages(mappedMessages);
      
      // 从加载的消息中提取地点信息
      const allLocations: LocationPoint[] = [];
      mappedMessages.forEach(msg => {
        if (msg.role === 'assistant' && shouldExtractLocations(msg.type || '', msg.agentType || '', msg.displayContent)) {
          const locations = extractMapLocations(msg.displayContent);
          locations.forEach(loc => {
            const exists = allLocations.find(existing => existing.name === loc.name);
            if (!exists) {
              allLocations.push(loc);
            }
          });
        }
      });
      
      if (allLocations.length > 0) {
        console.log('从加载的消息中提取到地点信息:', allLocations);
        setMapLocations(allLocations);
      } else {
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
            // 如果已经有最终答案，将其转换为数组处理多个消息
            if (currentGroup.finalAnswer) {
              if (!Array.isArray(currentGroup.finalAnswer)) {
                currentGroup.finalAnswer = [currentGroup.finalAnswer];
              }
              currentGroup.finalAnswer.push(message);
            } else {
              currentGroup.finalAnswer = message;
            }
          }
        } else {
          // 都关闭：所有消息都放入常规显示
          console.log('分类为最终答案 (都关闭):', message.type);
          // 如果已经有最终答案，将其转换为数组处理多个消息
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

  // 渲染深度思考气泡框
  const renderDeepThinkBubble = (deepThinkMessages: Message[]) => {
    if (!deepThinkMessages.length) return null;

    // 获取智能体类型（取第一个消息的agentType）
    const agentType = deepThinkMessages[0]?.agentType;
    const totalDuration = calculateDeepThinkTotalDuration(deepThinkMessages);

    return (
      <div style={{
        marginBottom: '16px',
        display: 'flex',
        justifyContent: 'flex-start'
      }}>
        <div style={{ 
          maxWidth: '75%', 
          minWidth: '300px',
          width: '100%'
        }}>
          {/* 智能体类型标签 - 移到外面 */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '6px'
          }}>
            {agentType && (
              <div style={{
                fontSize: '12px',
                color: '#8b5cf6',
                fontWeight: 500
              }}>
                {agentType}
              </div>
            )}
            {totalDuration > 0 && (
              <div style={{
                fontSize: '11px',
                color: '#9ca3af',
                background: '#f8fafc',
                padding: '2px 6px',
                borderRadius: '4px',
                border: '1px solid #f1f5f9'
              }}>
                总耗时 {formatDuration(totalDuration)}
              </div>
            )}
          </div>

          {/* 可折叠的深度思考内容 */}
          <Collapse 
            ghost
            size="small"
            className="deep-think-collapse"
            style={{
              background: '#f8fafc',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
            }}
            expandIcon={({ isActive }) => (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '13px',
                color: '#6b7280',
                fontWeight: 500,
                padding: '4px 8px',
                borderRadius: '6px',
                background: isActive ? '#e0e7ff' : '#f3f4f6',
                border: '1px solid',
                borderColor: isActive ? '#c7d2fe' : '#e5e7eb',
                transition: 'all 0.2s ease'
              }}>
                {isActive ? <UpOutlined style={{ fontSize: '11px' }} /> : <DownOutlined style={{ fontSize: '11px' }} />}
                <span>{isActive ? '收起' : '展开'}</span>
              </div>
            )}
          >
            <Panel 
              header={
                <div style={{
                  fontSize: '14px',
                  color: '#374151',
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <div style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: '#8b5cf6',
                    animation: 'deepThinkPulse 2s infinite'
                  }} />
                  深度思考过程
                </div>
              }
              key="1"
              style={{
                border: 'none',
                borderRadius: '12px'
              }}
            >
              <div 
                className="deep-think-content"
                style={{ 
                  maxHeight: '300px', 
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  padding: '4px 0',
                  scrollbarWidth: 'thin',
                  scrollbarColor: '#cbd5e1 transparent',
                  wordWrap: 'break-word',
                  wordBreak: 'break-word'
                }}
              >
                {deepThinkMessages.map((message, index) => (
                  <div 
                    key={message.id} 
                    className="message-bubble"
                    style={{
                      marginBottom: index < deepThinkMessages.length - 1 ? '8px' : '0',
                      padding: '8px 12px',
                      background: '#ffffff',
                      borderRadius: '8px',
                      border: '1px solid #f1f5f9',
                      fontSize: '13px',
                      lineHeight: '1.5',
                      wordWrap: 'break-word',
                      wordBreak: 'break-word',
                      overflowWrap: 'break-word',
                      width: '100%',
                      boxSizing: 'border-box',
                      position: 'relative'
                    }}
                  >
                    {/* 单个消息的耗时显示 */}
                    {message.duration && message.duration > 0 && (
                      <div style={{
                        position: 'absolute',
                        top: '4px',
                        right: '8px',
                        fontSize: '10px',
                        color: '#9ca3af',
                        background: 'rgba(255, 255, 255, 0.9)',
                        padding: '1px 4px',
                        borderRadius: '3px',
                        border: '1px solid #f1f5f9'
                      }}>
                        {formatDuration(message.duration)}
                      </div>
                    )}
                    
                    <ReactMarkdown
                      components={{
                        p: ({children}) => (
                          <div style={{ 
                            margin: '2px 0', 
                            fontSize: '13px', 
                            lineHeight: '1.5',
                            color: '#374151'
                          }}>
                            {children}
                          </div>
                        ),
                        code: ({children}) => (
                          <code style={{
                            background: '#f1f5f9',
                            color: '#4338ca',
                            padding: '1px 4px',
                            borderRadius: '3px',
                            fontSize: '12px',
                            fontFamily: 'SF Mono, Monaco, Consolas, monospace',
                            wordBreak: 'break-all',
                            overflowWrap: 'break-word'
                          }}>
                            {children}
                          </code>
                        ),
                        ul: ({children}) => (
                          <ul style={{ 
                            margin: '4px 0', 
                            paddingLeft: '14px',
                            fontSize: '13px',
                            lineHeight: '1.5'
                          }}>
                            {children}
                          </ul>
                        ),
                        li: ({children}) => (
                          <li style={{ marginBottom: '1px' }}>
                            {children}
                          </li>
                        )
                      }}
                    >
                      {message.displayContent}
                    </ReactMarkdown>
                  </div>
                ))}
              </div>
            </Panel>
          </Collapse>
        </div>
      </div>
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
          
          // 尝试提取地点信息（扩展检测范围）
          if (shouldExtractLocations(data.step_type, data.agent_type, updatedDisplayContent)) {
            const locations = extractMapLocations(updatedDisplayContent);
            if (locations.length > 0) {
              console.log('提取到地点信息:', locations);
              setMapLocations(prevLocations => {
                // 合并新的地点，避免重复
                const existingIds = prevLocations.map((loc: LocationPoint) => loc.id);
                const newLocations = locations.filter((loc: LocationPoint) => !existingIds.includes(loc.id));
                return [...prevLocations, ...newLocations];
              });
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
          
          // 尝试提取地点信息（扩展检测范围）
          if (shouldExtractLocations(data.step_type, data.agent_type, showContent)) {
            const locations = extractMapLocations(showContent);
            if (locations.length > 0) {
              console.log('提取到地点信息:', locations);
              setMapLocations(prevLocations => {
                // 合并新的地点，避免重复
                const existingIds = prevLocations.map((loc: LocationPoint) => loc.id);
                const newLocations = locations.filter((loc: LocationPoint) => !existingIds.includes(loc.id));
                return [...prevLocations, ...newLocations];
              });
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

  // 自定义表格组件
  const MarkdownTable = ({ children }: any) => {
    // 解析表格数据
    const parseTableData = (tableElement: any) => {
      const rows: any[] = [];
      const headers: string[] = [];
      
      React.Children.forEach(tableElement.props.children, (child: any) => {
        if (child?.type === 'thead') {
          React.Children.forEach(child.props.children, (row: any) => {
            if (row?.type === 'tr') {
              React.Children.forEach(row.props.children, (cell: any) => {
                if (cell?.type === 'th') {
                  headers.push(cell.props.children || '');
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
                  rowData[headers[cellIndex] || `col${cellIndex}`] = cell.props.children || '';
                  cellIndex++;
                }
              });
              rows.push(rowData);
            }
          });
        }
      });
      
      return { headers, rows };
    };

    const { headers, rows } = parseTableData(children);
    
    const columns = headers.map((header, index) => ({
      title: header,
      dataIndex: header || `col${index}`,
      key: header || `col${index}`,
      render: (text: any) => (
        <Text style={{ fontSize: '13px' }}>
          {Array.isArray(text) ? text.join('') : text}
        </Text>
      )
    }));

    return (
      <div style={{ margin: '12px 0', overflow: 'auto' }}>
        <Table
          columns={columns}
          dataSource={rows.map((row, index) => ({ ...row, key: index }))}
          pagination={false}
          size="small"
          bordered
          style={{
            fontSize: '13px'
          }}
          scroll={{ x: true }}
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
          marginBottom: '12px'
        }}
      >
        <div style={{
          maxWidth: '85%',  // 增加最大宽度以更好地显示表格
          minWidth: '120px',
          position: 'relative'
        }}>
          {/* 智能体类型标签 */}
          {!isUser && message.agentType && (
            <div style={{
              fontSize: '12px',
              color: '#8b5cf6',
              marginBottom: '4px',
              fontWeight: 500
            }}>
              {message.agentType}
            </div>
          )}
          
          {/* 消息气泡 */}
          <div
            className={`markdown-content ${isUser ? 'user-message' : ''}`}
            style={{
              background: isUser 
                ? '#6366f1' 
                : isError 
                  ? '#fef2f2' 
                  : '#ffffff',
              color: isUser 
                ? '#ffffff' 
                : isError 
                  ? '#dc2626' 
                  : '#1f2937',
              padding: '12px 16px',  // 增加内边距
              borderRadius: isUser 
                ? '16px 16px 4px 16px' 
                : '16px 16px 16px 4px',
              boxShadow: isUser 
                ? '0 1px 3px rgba(99, 102, 241, 0.3)'
                : '0 1px 3px rgba(0, 0, 0, 0.1)',
              border: isUser 
                ? 'none'
                : '1px solid #f1f5f9',
              fontSize: '14px',
              lineHeight: '1.6',  // 增加行高
              wordBreak: 'break-word',
              position: 'relative'
            }}
          >
            {/* 消息耗时显示 */}
            {!isUser && message.duration && message.duration > 0 && (
              <div style={{
                position: 'absolute',
                top: '4px',
                right: '8px',
                fontSize: '10px',
                color: '#9ca3af',
                background: 'rgba(255, 255, 255, 0.9)',
                padding: '1px 4px',
                borderRadius: '3px',
                border: '1px solid #f1f5f9'
              }}>
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
                
                // 表格组件
                table({children}) {
                  return <MarkdownTable>{children}</MarkdownTable>;
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
              {message.displayContent}
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
      background: '#f8fafc'
    }}>
      {/* 左侧聊天区域 */}
      <div style={{ 
        flex: showMap ? '0 0 60%' : 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRight: showMap ? '1px solid #e5e7eb' : 'none'
      }}>
        {/* 消息列表 - 豆包风格 */}
        <div style={{ 
          flex: 1, 
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
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
                您好，我是 Sage 助手
              </div>
              <div style={{ fontSize: '14px', lineHeight: '1.5', marginBottom: '24px', maxWidth: '320px' }}>
                我是您的多智能体协作助手，可以运用深度思考为您解决各种复杂问题。
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
                    深度思考
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
                    多智能体协作
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
                      title: "数学计算",
                      example: "计算 45 乘以 76 再减去 4 的结果",
                      icon: "🔢"
                    },
                    {
                      title: "代码编程", 
                      example: "用 Python 写一个快速排序算法",
                      icon: "💻"
                    },
                    {
                      title: "文档写作",
                      example: "帮我写一份项目总结报告的大纲",
                      icon: "📝"
                    },
                    {
                      title: "数据分析",
                      example: "分析这组销售数据的趋势和特点",
                      icon: "📊"
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
              <span>智能体正在思考...</span>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 豆包风格的输入区域 */}
      <div style={{ 
        padding: '16px 24px 20px',
        background: '#f8fafc',
        flexShrink: 0
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
              background: '#ffffff',
              transition: 'all 0.2s ease',
              minHeight: '140px',
              display: 'flex',
              flexDirection: 'column',
              border: '1px solid #f1f5f9'
            }}
          >
            {/* 顶部功能开关行 */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 16px 8px 16px',
              borderBottom: '1px solid #f8fafc'
            }}>
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

              {/* 右侧附加功能按钮 */}
              <div style={{
                display: 'flex',
                gap: '8px',
                alignItems: 'center'
              }}>
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
                <Button
                  type="text"
                  size="small"
                  icon={<EnvironmentOutlined />}
                  onClick={() => setShowMap(!showMap)}
                  style={{
                    color: showMap ? '#1890ff' : '#9ca3af',
                    fontSize: '12px',
                    height: '24px',
                    padding: '0 8px',
                    borderRadius: '6px',
                    background: showMap ? '#f0f9ff' : 'transparent'
                  }}
                >
                  地图
                </Button>
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
                  placeholder="发消息、输入 @ 选择技能或 / 选择文件"
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
                  height: '32px',
                  width: '32px',
                  padding: 0,
                  background: inputValue.trim() 
                    ? '#6366f1' 
                    : '#f1f5f9',
                  borderColor: inputValue.trim() 
                    ? '#6366f1' 
                    : '#f1f5f9',
                  color: inputValue.trim() 
                    ? '#ffffff' 
                    : '#9ca3af',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
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
          flex: '0 0 40%',
          height: '100vh',
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
      )}
    </div>
  );
});

export default ChatInterface; 