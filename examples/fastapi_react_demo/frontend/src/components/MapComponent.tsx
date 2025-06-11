import React, { useState, useRef, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import { Card, Input, Button, List, Avatar, Tag, Typography, Space } from 'antd';
import { SearchOutlined, EnvironmentOutlined, PlusOutlined } from '@ant-design/icons';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// 修复 leaflet 默认图标问题
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const { Text } = Typography;
const { Search } = Input;

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

const MapEvents: React.FC<{ onMapClick: (lat: number, lng: number) => void }> = ({ onMapClick }) => {
  useMapEvents({
    click: (e) => {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
};

const MapComponent: React.FC<MapComponentProps> = ({ 
  width = '100%', 
  height = '100%',
  locations: externalLocations = [],
  onLocationAdd
}) => {
  const [locations, setLocations] = useState<LocationPoint[]>(initialLocations);
  const [searchValue, setSearchValue] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<LocationPoint | null>(null);
  const mapRef = useRef<any>(null);

  // 当外部传入地点数据时更新本地状态
  useEffect(() => {
    if (externalLocations.length > 0) {
      setLocations(externalLocations);
      // 如果有地点数据，自动缩放地图以显示所有地点
      if (mapRef.current && externalLocations.length > 0) {
        const bounds = L.latLngBounds(externalLocations.map(loc => [loc.lat, loc.lng]));
        mapRef.current.fitBounds(bounds, { padding: [20, 20] });
      }
    }
  }, [externalLocations]);

  // 搜索位置
  const handleSearch = (value: string) => {
    setSearchValue(value);
    // 这里可以添加实际的地理编码搜索功能
    console.log('搜索位置:', value);
  };

  // 添加新位置点
  const handleMapClick = (lat: number, lng: number) => {
    const newLocation: LocationPoint = {
      id: Date.now().toString(),
      name: `地点 ${locations.length + 1}`,
      lat,
      lng,
      description: '点击地图添加的地点',
      category: '其他'
    };
    const updatedLocations = [...locations, newLocation];
    setLocations(updatedLocations);
    
    // 通知父组件
    if (onLocationAdd) {
      onLocationAdd(newLocation);
    }
  };

  // 定位到指定位置
  const flyToLocation = (location: LocationPoint) => {
    if (mapRef.current) {
      mapRef.current.flyTo([location.lat, location.lng], 16);
      setSelectedLocation(location);
    }
  };

  // 获取分类颜色
  const getCategoryColor = (category?: string) => {
    const colors: { [key: string]: string } = {
      '景点': '#87d068',
      '酒店': '#108ee9',
      '餐厅': '#f50',
      '交通': '#2db7f5',
      '购物': '#722ed1',
      '娱乐': '#fa8c16',
      '其他': '#999'
    };
    return colors[category || '其他'] || '#999';
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
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
    }}>
      {/* 地图头部控制栏 */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #f0f0f0',
        background: '#fafafa'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '8px'
        }}>
          <Text strong style={{ fontSize: '14px' }}>
            <EnvironmentOutlined style={{ marginRight: '8px', color: '#1890ff' }} />
            行程地点
          </Text>
          <Text type="secondary" style={{ fontSize: '12px' }}>
            {locations.length > 0 ? `${locations.length} 个地点` : '暂无地点'}
          </Text>
        </div>
        
        <Search
          placeholder="搜索行程地点"
          allowClear
          size="small"
          onSearch={handleSearch}
          style={{ width: '100%' }}
        />
      </div>

      {/* 地图容器 */}
      <div style={{ flex: 1, position: 'relative' }}>
        <MapContainer
          center={[39.9042, 116.4074]} // 北京天安门为中心
          zoom={6}
          style={{ width: '100%', height: '100%' }}
          ref={mapRef}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          <MapEvents onMapClick={handleMapClick} />
          
          {locations.map((location) => (
            <Marker
              key={location.id}
              position={[location.lat, location.lng]}
              eventHandlers={{
                click: () => setSelectedLocation(location),
              }}
            >
              <Popup>
                <div style={{ minWidth: '200px' }}>
                  <div style={{ 
                    fontWeight: 'bold', 
                    marginBottom: '4px',
                    fontSize: '14px'
                  }}>
                    {location.name}
                  </div>
                  {location.category && (
                    <Tag 
                      color={getCategoryColor(location.category)}
                      style={{ marginBottom: '8px' }}
                    >
                      {location.category}
                    </Tag>
                  )}
                  <div style={{ 
                    fontSize: '12px', 
                    color: '#666',
                    lineHeight: '1.4'
                  }}>
                    {location.description}
                  </div>
                  <div style={{ 
                    fontSize: '11px', 
                    color: '#999',
                    marginTop: '4px'
                  }}>
                    {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {/* 地点列表 */}
      <div style={{
        maxHeight: '200px',
        overflowY: 'auto',
        borderTop: '1px solid #f0f0f0',
        background: '#fafafa'
      }}>
        {locations.length === 0 ? (
          <div style={{
            padding: '20px',
            textAlign: 'center',
            color: '#999',
            fontSize: '12px'
          }}>
            <EnvironmentOutlined style={{ fontSize: '24px', marginBottom: '8px', display: 'block' }} />
            暂无行程地点
            <br />
            <span style={{ fontSize: '11px' }}>
              在聊天中提到地点时会自动显示在地图上
            </span>
          </div>
        ) : (
          <List
            size="small"
            dataSource={locations}
            renderItem={(location) => (
            <List.Item
              style={{
                padding: '8px 16px',
                cursor: 'pointer',
                backgroundColor: selectedLocation?.id === location.id ? '#e6f7ff' : 'transparent'
              }}
              onClick={() => flyToLocation(location)}
            >
              <List.Item.Meta
                avatar={
                  <Avatar 
                    size="small" 
                    style={{ 
                      backgroundColor: getCategoryColor(location.category),
                      fontSize: '10px'
                    }}
                  >
                    {location.name.charAt(0)}
                  </Avatar>
                }
                title={
                  <div style={{ fontSize: '13px' }}>
                    {location.name}
                    {location.category && (
                      <Tag 
                        color={getCategoryColor(location.category)}
                        style={{ marginLeft: '8px', fontSize: '10px' }}
                      >
                        {location.category}
                      </Tag>
                    )}
                  </div>
                }
                description={
                  <div style={{ fontSize: '11px', color: '#666' }}>
                    {location.description}
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