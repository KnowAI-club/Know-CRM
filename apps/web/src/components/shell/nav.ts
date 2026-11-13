import {
  BarChart3,
  Briefcase,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  FileText,
  FolderOpen,
  Home,
  Inbox,
  LayoutTemplate,
  Mail,
  Receipt,
  Settings,
  Sprout,
  Users,
  Wallet,
  ListChecks,
  BellRing,
  Package,
  ClipboardList,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

export const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Work',
    items: [
      { href: '/', label: 'Home', icon: Home },
      { href: '/today', label: 'My day', icon: ListChecks },
      { href: '/tasks', label: 'Tasks', icon: CheckSquare },
      { href: '/meetings', label: 'Meetings', icon: CalendarDays },
      { href: '/reminders', label: 'Reminders', icon: BellRing },
    ],
  },
  {
    section: 'Sales',
    items: [
      { href: '/leads', label: 'Leads', icon: Inbox },
      { href: '/nurtures', label: 'Nurtures', icon: Sprout },
      { href: '/clients', label: 'Clients', icon: Users },
      { href: '/forms', label: 'Lead forms', icon: ClipboardList },
      { href: '/booking', label: 'Booking pages', icon: CalendarClock },
    ],
  },
  {
    section: 'Delivery',
    items: [
      { href: '/projects', label: 'Projects', icon: Briefcase },
      { href: '/files', label: 'Files', icon: FolderOpen },
      { href: '/inbox', label: 'Client messages', icon: Mail, adminOnly: true },
    ],
  },
  {
    section: 'Money',
    items: [
      { href: '/invoices', label: 'Invoices', icon: Receipt },
      { href: '/expenses', label: 'Expenses', icon: Wallet },
      { href: '/services', label: 'Services', icon: Package },
    ],
  },
  {
    section: 'Workspace',
    items: [
      { href: '/reports', label: 'Reports', icon: BarChart3 },
      { href: '/templates', label: 'Templates', icon: LayoutTemplate },
      { href: '/documents', label: 'Documents', icon: FileText },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];
