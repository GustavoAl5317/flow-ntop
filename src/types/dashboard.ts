export type AttackEvent = {
  id: string;
  target: string;
  type: string;
  protocol: string;
  gbps: number;
  mpps: number;
  status: 'active' | 'mitigating' | 'mitigated';
  startedAt: string;
  duration: string;
  asn: string;
};

export type TopIP = {
  ip: string;
  country: string;
  countryCode: string;
  gbps: number;
  packets: number;
  protocol: string;
};

export type LinkStatus = {
  name: string;
  capacity: number;
  usage: number;
  attackLoad: number;
};

export type OriginCountry = {
  country: string;
  countryCode: string;
  attacks: number;
  gbps: number;
  percentage: number;
};
