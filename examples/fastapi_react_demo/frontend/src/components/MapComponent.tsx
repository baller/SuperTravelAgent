import React, { useState, useRef, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { List, Avatar, Tag, Typography } from 'antd';
import { EnvironmentOutlined } from '@ant-design/icons';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// 修复 leaflet 默认图标问题
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// 弧线组件 - 使用 useMap hook
const ArcLines: React.FC<{
  connections: Array<{ from: [number, number]; to: [number, number] }>;
}> = ({ connections }) => {
  const map = useMap();
  const arcLinesRef = useRef<L.Polyline[]>([]);

  useEffect(() => {
    if (!map) return;

    console.log('ArcLines: 开始绘制连线，连接数量:', connections.length);

    // 清除之前的连线
    arcLinesRef.current.forEach(line => {
      map.removeLayer(line);
    });
    arcLinesRef.current = [];

    // 计算弧线路径
    const calculateArcPath = (start: [number, number], end: [number, number]): [number, number][] => {
      const [lat1, lng1] = start;
      const [lat2, lng2] = end;
      
      // 计算中点
      const midLat = (lat1 + lat2) / 2;
      const midLng = (lng1 + lng2) / 2;
      
      // 计算距离来确定弧线高度
      const distance = Math.sqrt(Math.pow(lat2 - lat1, 2) + Math.pow(lng2 - lng1, 2));
      const arcHeight = distance * 0.3; // 弧线高度为距离的30%
      
      // 计算垂直于连线的方向
      const perpLat = -(lng2 - lng1);
      const perpLng = lat2 - lat1;
      const perpLength = Math.sqrt(perpLat * perpLat + perpLng * perpLng);
      
      if (perpLength === 0) return [start, end]; // 防止除零
      
      // 标准化垂直向量
      const normPerpLat = perpLat / perpLength;
      const normPerpLng = perpLng / perpLength;
      
      // 计算弧线控制点
      const controlLat = midLat + normPerpLat * arcHeight;
      const controlLng = midLng + normPerpLng * arcHeight;
      
      // 生成弧线上的点
      const points: [number, number][] = [];
      const segments = 30;
      
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const t2 = t * t;
        const t3 = 1 - t;
        const t4 = t3 * t3;
        
        // 二次贝塞尔曲线公式
        const lat = t4 * lat1 + 2 * t3 * t * controlLat + t2 * lat2;
        const lng = t4 * lng1 + 2 * t3 * t * controlLng + t2 * lng2;
        
        points.push([lat, lng]);
      }
      
      return points;
    };

    // 添加新的连线
    connections.forEach((connection, index) => {
      console.log(`ArcLines: 绘制连线 ${index + 1}:`, connection.from, '->', connection.to);
      
      const arcPath = calculateArcPath(connection.from, connection.to);
      
      const arcLine = L.polyline(arcPath, {
        color: '#1890ff',
        weight: 3,
        opacity: 0.7,
        dashArray: '10,10',
        className: 'arc-line'
      }).addTo(map);

      arcLinesRef.current.push(arcLine);
      console.log(`ArcLines: 连线 ${index + 1} 已添加到地图`);
    });

    console.log('ArcLines: 所有连线绘制完成，总数:', arcLinesRef.current.length);

    // 清理函数
    return () => {
      arcLinesRef.current.forEach(line => {
        map.removeLayer(line);
      });
      arcLinesRef.current = [];
    };
  }, [map, connections]);

  return null;
};

// 创建彩色圆形标记图标
const createColorIcon = (location: LocationPoint, number: number): L.DivIcon => {
  const color = getCategoryColor(location.category);
  return L.divIcon({
    html: `
      <div style="
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        transform: translateX(-50%);
      ">
        <!-- 主标记点 - 根据分类颜色 -->
        <div style="
          background: ${color};
          color: white;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          border: 3px solid white;
          box-shadow: 0 2px 6px ${color}40;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 12px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          position: relative;
          z-index: 1000;
        ">
          ${number}
        </div>
        
        <!-- 地点名称标签 -->
        <div style="
          background: rgba(255, 255, 255, 0.95);
          border: 1px solid ${color}30;
          border-radius: 4px;
          padding: 2px 6px;
          margin-top: 4px;
          font-size: 11px;
          font-weight: 500;
          color: #333;
          white-space: nowrap;
          max-width: 120px;
          overflow: hidden;
          text-overflow: ellipsis;
          box-shadow: 0 1px 3px ${color}20;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          text-align: center;
          position: relative;
          z-index: 999;
        ">
          ${location.name}
        </div>
      </div>
    `,
    className: 'custom-marker',
    iconSize: [28, 60],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28]
  });
};

// 获取分类颜色 - 不同类别使用不同颜色
const getCategoryColor = (category?: string) => {
  const colors: { [key: string]: string } = {
    '景点': '#1890ff',
    '酒店': '#52c41a',
    '餐厅': '#fa8c16',
    '交通': '#722ed1',
    '购物': '#eb2f96',
    '娱乐': '#13c2c2',
    'attraction': '#1890ff',
    'hotel': '#52c41a',
    'restaurant': '#fa8c16',
    'transport': '#722ed1',
    'shopping': '#eb2f96',
    'entertainment': '#13c2c2',
    'temple': '#1890ff',
    'shrine': '#1890ff',
    'park': '#52c41a',
    'museum': '#1890ff',
    '人文古迹': '#1890ff',
    '自然风光': '#52c41a',
    '文化体验': '#13c2c2',
    '历史建筑': '#1890ff',
    '亲子娱乐': '#eb2f96',
    'other': '#8c8c8c',
    '其他': '#8c8c8c'
  };
  return colors[category || '景点'] || '#1890ff';
};

const { Text } = Typography;

interface LocationPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  description?: string;
  category?: string;
}

interface MapComponentProps {
  width?: number | string;
  height?: number | string;
  locations?: LocationPoint[];
  onLocationAdd?: (location: LocationPoint) => void;
}

// 空的初始位置数组，将根据对话内容动态填充
const initialLocations: LocationPoint[] = [];

const MapComponent: React.FC<MapComponentProps> = ({ 
  width = '100%', 
  height = '100%',
  locations: externalLocations = []
}) => {
  const [locations, setLocations] = useState<LocationPoint[]>(initialLocations);
  const [selectedLocation, setSelectedLocation] = useState<LocationPoint | null>(null);
  const mapRef = useRef<any>(null);
  const prevLocationsRef = useRef<LocationPoint[]>([]);

  // 检查地点数据是否真的发生了变化
  const hasLocationsChanged = () => {
    if (externalLocations.length !== prevLocationsRef.current.length) return true;
    
    // 检查每个地点的ID是否相同
    for (let i = 0; i < externalLocations.length; i++) {
      if (externalLocations[i].id !== prevLocationsRef.current[i]?.id) {
        return true;
      }
    }
    
    return false;
  };

  // 处理地点数据变化
  useEffect(() => {
    if (hasLocationsChanged()) {
      console.log('地点数据发生变化:', {
        之前的地点数量: prevLocationsRef.current.length,
        新的地点数量: externalLocations.length,
        新地点: externalLocations.map(loc => loc.name)
      });
      
      setLocations(externalLocations);
      prevLocationsRef.current = [...externalLocations]; // 使用深拷贝避免引用问题

      // 当地点数据变化时，调整地图视图
      if (mapRef.current && externalLocations.length > 0) {
        // 延迟一下确保地图标记已经渲染
        setTimeout(() => {
          // 创建包含所有地点的边界
          const bounds = L.latLngBounds(
            externalLocations.map(loc => [loc.lat, loc.lng])
          );
          
          // 添加一些内边距
          const padding = [50, 50];
          
          // 使用flyToBounds平滑过渡到新的视图
          mapRef.current.flyToBounds(bounds, {
            padding: padding,
            duration: 1.5,
            easeLinearity: 0.25
          });
        }, 200);
      } else if (mapRef.current && externalLocations.length === 0) {
        // 当地点数据为空时，重置到默认位置
        console.log('地点数据为空，重置地图到默认位置');
        mapRef.current.setView([39.9042, 116.4074], 12);
      }
    }
  }, [externalLocations]);

  // 处理地图加载完成
  useEffect(() => {
    if (mapRef.current && locations.length > 0) {
      const bounds = L.latLngBounds(
        locations.map(loc => [loc.lat, loc.lng])
      );
      mapRef.current.flyToBounds(bounds, {
        padding: [50, 50],
        duration: 1.5,
        easeLinearity: 0.25
      });
    }
  }, [mapRef.current]);

  // 定位到指定位置
  const flyToLocation = (location: LocationPoint) => {
    if (mapRef.current) {
      mapRef.current.flyTo([location.lat, location.lng], 16);
      setSelectedLocation(location);
    }
  };

  // 获取分类中文名称
  const getCategoryName = (category?: string) => {
    const categoryMap: { [key: string]: string } = {
      'attraction': '景点',
      'hotel': '酒店',
      'restaurant': '餐厅',
      'transport': '交通',
      'shopping': '购物',
      'entertainment': '娱乐',
      'temple': '寺庙',
      'shrine': '神社',
      'park': '公园',
      'museum': '博物馆',
      'other': '其他',
      // 新增中文分类
      '人文古迹': '人文古迹',
      '自然风光': '自然风光',
      '文化体验': '文化体验',
      '历史建筑': '历史建筑',
      '亲子娱乐': '亲子娱乐'
    };
    return categoryMap[category || 'other'] || category || '景点';
  };

  // 生成弧线连接的地点对
  const getArcConnections = () => {
    if (locations.length < 2) {
      console.log('getArcConnections: 地点数量不足，无法生成连线');
      return [];
    }
    
    const connections = [];
    for (let i = 0; i < locations.length - 1; i++) {
      connections.push({
        from: [locations[i].lat, locations[i].lng] as [number, number],
        to: [locations[i + 1].lat, locations[i + 1].lng] as [number, number]
      });
    }
    
    console.log('getArcConnections: 生成连线数量:', connections.length);
    connections.forEach((conn, idx) => {
      console.log(`连线 ${idx + 1}: (${conn.from[0]}, ${conn.from[1]}) -> (${conn.to[0]}, ${conn.to[1]})`);
    });
    
    return connections;
  };

  return (
    <div style={{ 
      width, 
      height,
      display: 'flex',
      flexDirection: 'column',
      background: '#fff',
      borderRadius: '8px',
      overflow: 'hidden',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
      position: 'relative'
    }}>
      {/* 添加自定义CSS样式 */}
      <style>{`
        .custom-marker {
          background: transparent !important;
          border: none !important;
        }
        .custom-marker div {
          animation: markerDrop 0.6s ease-out;
        }
        @keyframes markerDrop {
          0% {
            transform: translateY(-30px) translateX(-50%);
            opacity: 0;
          }
          60% {
            transform: translateY(5px) translateX(-50%);
          }
          100% {
            transform: translateY(0) translateX(-50%);
            opacity: 1;
          }
        }
        .arc-line {
          animation: arcFlow 3s linear infinite;
        }
        @keyframes arcFlow {
          0% {
            stroke-dashoffset: 0;
          }
          100% {
            stroke-dashoffset: 40;
          }
        }
        .leaflet-popup-content-wrapper {
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .leaflet-popup-content {
          margin: 0;
          padding: 0;
        }
        .leaflet-popup-tip {
          background: white;
        }
      `}</style>

      {/* 地图容器 */}
      <div style={{ flex: 1, position: 'relative' }}>
        <MapContainer
          center={[39.9042, 116.4074]} // 北京天安门
          zoom={12}
          style={{ width: '100%', height: '100%' }}
          ref={mapRef}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          {/* 地点标记 */}
          {locations.map((location, index) => {
            return (
              <Marker
                key={location.id}
                position={[location.lat, location.lng]}
                icon={createColorIcon(location, index + 1)}
                eventHandlers={{
                  click: () => setSelectedLocation(location),
                }}
              >
                <Popup>
                  <div style={{ minWidth: '260px', padding: '16px' }}>
                    <div style={{ 
                      display: 'flex',
                      alignItems: 'center',
                      marginBottom: '12px'
                    }}>
                      <div style={{
                        background: getCategoryColor(location.category),
                        color: 'white',
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        marginRight: '10px',
                        flexShrink: 0
                      }}>
                        {index + 1}
                      </div>
                      <div style={{ 
                        fontWeight: 'bold', 
                        fontSize: '16px',
                        color: '#1a1a1a',
                        lineHeight: '1.4'
                      }}>
                        {location.name}
                      </div>
                    </div>
                    
                    <div style={{ marginBottom: '12px' }}>
                      <Tag 
                        color={getCategoryColor(location.category)}
                        style={{ 
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontWeight: '500'
                        }}
                      >
                        {getCategoryName(location.category)}
                      </Tag>
                    </div>
                    
                    {location.description && (
                      <div style={{ 
                        fontSize: '13px', 
                        color: '#666',
                        lineHeight: '1.5',
                        marginBottom: '12px',
                        padding: '8px 12px',
                        backgroundColor: '#f8f9fa',
                        borderRadius: '6px',
                        borderLeft: `3px solid ${getCategoryColor(location.category)}`
                      }}>
                        {location.description}
                      </div>
                    )}
                    
                    <div style={{ 
                      fontSize: '11px', 
                      color: '#999',
                      borderTop: '1px solid #f0f0f0',
                      paddingTop: '8px',
                      marginTop: '8px'
                    }}>
                      坐标: {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
          
          {/* 弧线连接 */}
          <ArcLines connections={getArcConnections()} />
        </MapContainer>
      </div>

      {/* 地点列表 */}
      <div style={{
        maxHeight: '200px',
        overflowY: 'auto',
        borderTop: '1px solid #f0f0f0',
        background: '#fafafa'
      }}>
        {/* 地点列表标题栏 */}
        <div style={{
          padding: '8px 16px',
          borderBottom: '1px solid #f0f0f0',
          background: '#f8f9fa',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{
            fontSize: '13px',
            fontWeight: 'bold',
            color: '#333'
          }}>
            行程地点 ({locations.length})
          </div>
          {locations.length > 0 && (
            <button
              onClick={() => {
                console.log('手动清理地点按钮被点击');
                setLocations([]);
                prevLocationsRef.current = [];
              }}
              style={{
                background: 'none',
                border: '1px solid #d9d9d9',
                borderRadius: '4px',
                padding: '2px 8px',
                fontSize: '11px',
                color: '#666',
                cursor: 'pointer',
                lineHeight: '16px'
              }}
            >
              清空
            </button>
          )}
        </div>

        {locations.length === 0 ? (
          <div style={{
            padding: '20px',
            textAlign: 'center',
            color: '#999',
            fontSize: '12px'
          }}>
            <EnvironmentOutlined style={{ fontSize: '24px', marginBottom: '8px', display: 'block' }} />
            暂无地点
            <br />
            <span style={{ fontSize: '11px' }}>
              在聊天中提到地点时会自动显示在地图上
            </span>
          </div>
        ) : (
          <List
            size="small"
            dataSource={locations}
            renderItem={(location, index) => (
            <List.Item
              style={{
                padding: '8px 16px',
                cursor: 'pointer',
                backgroundColor: selectedLocation?.id === location.id ? '#e6f7ff' : 'transparent',
                borderBottom: index < locations.length - 1 ? '1px solid #f0f0f0' : 'none'
              }}
              onClick={() => flyToLocation(location)}
            >
              <List.Item.Meta
                avatar={
                  <Avatar 
                    size="small" 
                    style={{ 
                      backgroundColor: getCategoryColor(location.category),
                      fontSize: '10px',
                      fontWeight: 'bold'
                    }}
                  >
                    {index + 1}
                  </Avatar>
                }
                title={
                  <div style={{ fontSize: '13px' }}>
                    <span style={{ fontWeight: 'bold', marginRight: '6px' }}>
                      {location.name}
                    </span>
                    <Tag 
                      color={getCategoryColor(location.category)}
                      style={{ 
                        marginLeft: '8px', 
                        fontSize: '10px',
                        padding: '0 6px',
                        lineHeight: '16px'
                      }}
                    >
                      {getCategoryName(location.category)}
                    </Tag>
                  </div>
                }
                description={
                  <div style={{ 
                    fontSize: '11px', 
                    color: '#666',
                    marginTop: '4px',
                    lineHeight: '1.4'
                  }}>
                    {location.description && (
                      <div style={{ marginBottom: '2px' }}>{location.description}</div>
                    )}
                    <div style={{ color: '#999' }}>
                      {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
                    </div>
                  </div>
                }
              />
            </List.Item>
            )}
          />
        )}
      </div>
    </div>
  );
};

export default MapComponent; 