export type Page = 'home' | 'create' | 'inspiration' | 'workspace' | 'today' | 'review';

export type RightPanel = 'map' | 'agent' | 'conflicts' | 'versions';

export type RunState =
  | 'idle'
  | 'understanding'
  | 'validating'
  | 'preview'
  | 'succeeded'
  | 'cancelled';

export type ItemStatus = 'planned' | 'booked' | 'done' | 'skipped';

export interface ItineraryItem {
  id: string;
  time: string;
  title: string;
  category: string;
  duration: string;
  cost: number;
  travel?: string;
  reason: string;
  source: string;
  freshness: '实时' | '缓存' | '演示数据';
  locked?: boolean;
  status: ItemStatus;
  coordinates: [latitude: number, longitude: number];
}

export interface TripDay {
  id: string;
  date: string;
  weekday: string;
  title: string;
  weather: string;
  walking: string;
  items: ItineraryItem[];
}

export interface PlanVersion {
  id: string;
  title: string;
  time: string;
  note: string;
  active: boolean;
}
