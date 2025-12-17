/**
 * Schema Definitions
 *
 * Provides structured documentation of Harvest API types and enums
 * for the harvest_get_schema tool.
 */

export interface FieldDefinition {
  name: string;
  type: string;
  description: string;
  required?: boolean;
  enum_values?: string[];
}

export interface EntityDefinition {
  name: string;
  description: string;
  fields: FieldDefinition[];
}

export interface EnumDefinition {
  name: string;
  description: string;
  values: { value: string; description: string }[];
}

export interface SchemaCategory {
  name: string;
  description: string;
  entities?: EntityDefinition[];
  enums?: EnumDefinition[];
}

// ============================================
// ENUM DEFINITIONS
// ============================================

export const ENUMS: EnumDefinition[] = [
  {
    name: 'invoice_state',
    description: 'Possible states for an invoice',
    values: [
      { value: 'draft', description: 'Invoice is being prepared, not sent to client' },
      { value: 'open', description: 'Invoice has been sent to client, awaiting payment' },
      { value: 'paid', description: 'Invoice has been fully paid' },
      { value: 'closed', description: 'Invoice has been closed (may be partially paid or written off)' },
    ],
  },
  {
    name: 'expense_category_unit_type',
    description: 'Unit types for expense categories',
    values: [
      { value: 'unit', description: 'Generic unit' },
      { value: 'mile', description: 'Mileage tracking' },
      { value: 'km', description: 'Kilometer tracking' },
    ],
  },
  {
    name: 'budget_by',
    description: 'How project budget is calculated',
    values: [
      { value: 'project', description: 'Budget is for the entire project' },
      { value: 'project_cost', description: 'Budget is based on project cost' },
      { value: 'task', description: 'Budget is per task' },
      { value: 'task_fees', description: 'Budget is based on task fees' },
      { value: 'person', description: 'Budget is per person assigned' },
      { value: 'none', description: 'No budget tracking' },
    ],
  },
  {
    name: 'bill_by',
    description: 'How a project is billed',
    values: [
      { value: 'Project', description: 'Fixed project fee' },
      { value: 'Tasks', description: 'Billed by task rates' },
      { value: 'People', description: 'Billed by individual person rates' },
      { value: 'none', description: 'Non-billable project' },
    ],
  },
  {
    name: 'profitability_mode',
    description: 'Calculation modes for profitability analysis',
    values: [
      { value: 'time_based', description: 'Calculate using hours × rates from time entries' },
      { value: 'invoice_based', description: 'Calculate using actual invoiced amounts vs costs' },
      { value: 'hybrid', description: 'Use invoice amounts where available, time-based for unbilled work' },
    ],
  },
  {
    name: 'group_by',
    description: 'Dimensions for grouping compute results',
    values: [
      { value: 'client', description: 'Group by client' },
      { value: 'project', description: 'Group by project' },
      { value: 'user', description: 'Group by user/team member' },
      { value: 'task', description: 'Group by task type' },
      { value: 'date', description: 'Group by individual date' },
      { value: 'week', description: 'Group by week (starting Monday)' },
      { value: 'month', description: 'Group by month (YYYY-MM)' },
    ],
  },
  {
    name: 'entity_type',
    description: 'Types of entities for entity resolution',
    values: [
      { value: 'client', description: 'Client/customer' },
      { value: 'project', description: 'Project' },
      { value: 'user', description: 'User/team member' },
      { value: 'task', description: 'Task type' },
    ],
  },
  {
    name: 'match_type',
    description: 'Types of matches returned by entity resolution',
    values: [
      { value: 'exact', description: 'Exact case-sensitive match' },
      { value: 'normalized', description: 'Match after normalizing (lowercase, removing suffixes like Inc., LLC)' },
      { value: 'partial', description: 'Substring match (query contained in name or vice versa)' },
      { value: 'fuzzy', description: 'Fuzzy match based on Levenshtein distance' },
    ],
  },
  {
    name: 'rate_source',
    description: 'Source of a rate value',
    values: [
      { value: 'harvest_api', description: 'Rate retrieved from Harvest API (most authoritative)' },
      { value: 'config_file', description: 'Rate from rates.json configuration file' },
      { value: 'env_default', description: 'Rate from DEFAULT_COST_RATE environment variable' },
      { value: 'fallback_zero', description: 'Zero rate when no other source available' },
    ],
  },
];

// ============================================
// ENTITY DEFINITIONS
// ============================================

export const ENTITIES: EntityDefinition[] = [
  {
    name: 'TimeEntry',
    description: 'A time tracking entry for a user on a project task',
    fields: [
      { name: 'id', type: 'number', description: 'Unique identifier', required: true },
      { name: 'spent_date', type: 'string (YYYY-MM-DD)', description: 'Date the time was logged', required: true },
      { name: 'hours', type: 'number', description: 'Hours logged (decimal)', required: true },
      { name: 'rounded_hours', type: 'number', description: 'Hours rounded per project settings' },
      { name: 'notes', type: 'string | null', description: 'Notes/description for the entry' },
      { name: 'is_locked', type: 'boolean', description: 'Whether the entry is locked for editing' },
      { name: 'is_billed', type: 'boolean', description: 'Whether the entry has been invoiced' },
      { name: 'is_running', type: 'boolean', description: 'Whether a timer is currently running' },
      { name: 'billable', type: 'boolean', description: 'Whether the entry is billable' },
      { name: 'billable_rate', type: 'number | null', description: 'Rate billed to client per hour' },
      { name: 'cost_rate', type: 'number | null', description: 'Internal cost rate per hour' },
      { name: 'user', type: 'object', description: 'User who logged the time { id, name }' },
      { name: 'client', type: 'object', description: 'Client for the project { id, name }' },
      { name: 'project', type: 'object', description: 'Project { id, name, code }' },
      { name: 'task', type: 'object', description: 'Task type { id, name }' },
    ],
  },
  {
    name: 'Client',
    description: 'A client/customer organization',
    fields: [
      { name: 'id', type: 'number', description: 'Unique identifier', required: true },
      { name: 'name', type: 'string', description: 'Client name', required: true },
      { name: 'is_active', type: 'boolean', description: 'Whether the client is active' },
      { name: 'address', type: 'string | null', description: 'Client address' },
      { name: 'currency', type: 'string', description: 'Default currency (e.g., USD, EUR)' },
    ],
  },
  {
    name: 'Project',
    description: 'A project for a client',
    fields: [
      { name: 'id', type: 'number', description: 'Unique identifier', required: true },
      { name: 'name', type: 'string', description: 'Project name', required: true },
      { name: 'code', type: 'string | null', description: 'Project code' },
      { name: 'is_active', type: 'boolean', description: 'Whether the project is active' },
      { name: 'is_billable', type: 'boolean', description: 'Whether time on this project is billable' },
      { name: 'bill_by', type: 'string', description: 'Billing method', enum_values: ['Project', 'Tasks', 'People', 'none'] },
      { name: 'budget', type: 'number | null', description: 'Project budget (hours or amount)' },
      { name: 'budget_by', type: 'string', description: 'Budget type', enum_values: ['project', 'project_cost', 'task', 'task_fees', 'person', 'none'] },
      { name: 'hourly_rate', type: 'number | null', description: 'Default hourly rate for the project' },
      { name: 'cost_budget', type: 'number | null', description: 'Cost budget if using cost-based budgeting' },
      { name: 'client', type: 'object', description: 'Client { id, name }' },
    ],
  },
  {
    name: 'User',
    description: 'A team member/user in the Harvest account',
    fields: [
      { name: 'id', type: 'number', description: 'Unique identifier', required: true },
      { name: 'first_name', type: 'string', description: 'First name', required: true },
      { name: 'last_name', type: 'string', description: 'Last name', required: true },
      { name: 'email', type: 'string', description: 'Email address', required: true },
      { name: 'is_active', type: 'boolean', description: 'Whether the user is active' },
      { name: 'is_admin', type: 'boolean', description: 'Whether the user has admin privileges' },
      { name: 'is_project_manager', type: 'boolean', description: 'Whether the user can manage projects' },
      { name: 'cost_rate', type: 'number | null', description: 'Internal cost rate per hour' },
      { name: 'default_hourly_rate', type: 'number | null', description: 'Default billable rate' },
      { name: 'weekly_capacity', type: 'number', description: 'Weekly capacity in seconds (default: 126000 = 35h)' },
    ],
  },
  {
    name: 'Task',
    description: 'A task type that can be assigned to projects',
    fields: [
      { name: 'id', type: 'number', description: 'Unique identifier', required: true },
      { name: 'name', type: 'string', description: 'Task name', required: true },
      { name: 'is_active', type: 'boolean', description: 'Whether the task is active' },
      { name: 'is_default', type: 'boolean', description: 'Whether this task is added to new projects by default' },
      { name: 'default_hourly_rate', type: 'number | null', description: 'Default hourly rate for this task type' },
      { name: 'billable_by_default', type: 'boolean', description: 'Whether time logged to this task is billable by default' },
    ],
  },
  {
    name: 'Invoice',
    description: 'An invoice sent to a client',
    fields: [
      { name: 'id', type: 'number', description: 'Unique identifier', required: true },
      { name: 'number', type: 'string', description: 'Invoice number', required: true },
      { name: 'amount', type: 'number', description: 'Total invoice amount', required: true },
      { name: 'due_amount', type: 'number', description: 'Amount still owed' },
      { name: 'state', type: 'string', description: 'Invoice state', enum_values: ['draft', 'open', 'paid', 'closed'] },
      { name: 'issue_date', type: 'string (YYYY-MM-DD)', description: 'Date invoice was issued' },
      { name: 'due_date', type: 'string (YYYY-MM-DD)', description: 'Payment due date' },
      { name: 'period_start', type: 'string | null', description: 'Start of billing period' },
      { name: 'period_end', type: 'string | null', description: 'End of billing period' },
      { name: 'client', type: 'object', description: 'Client { id, name }' },
      { name: 'line_items', type: 'array', description: 'Invoice line items' },
    ],
  },
  {
    name: 'Expense',
    description: 'An expense entry',
    fields: [
      { name: 'id', type: 'number', description: 'Unique identifier', required: true },
      { name: 'total_cost', type: 'number', description: 'Total expense cost', required: true },
      { name: 'units', type: 'number', description: 'Number of units' },
      { name: 'spent_date', type: 'string (YYYY-MM-DD)', description: 'Date expense was incurred' },
      { name: 'notes', type: 'string | null', description: 'Expense notes' },
      { name: 'is_billed', type: 'boolean', description: 'Whether the expense has been invoiced' },
      { name: 'billable', type: 'boolean', description: 'Whether the expense is billable' },
      { name: 'user', type: 'object', description: 'User who logged the expense { id, name }' },
      { name: 'project', type: 'object', description: 'Project { id, name }' },
      { name: 'expense_category', type: 'object', description: 'Category { id, name }' },
    ],
  },
];

// ============================================
// SCHEMA CATEGORIES
// ============================================

export const SCHEMA_CATEGORIES: SchemaCategory[] = [
  {
    name: 'time_tracking',
    description: 'Time entries and related data',
    entities: ENTITIES.filter(e => ['TimeEntry'].includes(e.name)),
  },
  {
    name: 'clients_projects',
    description: 'Clients, projects, and task types',
    entities: ENTITIES.filter(e => ['Client', 'Project', 'Task'].includes(e.name)),
  },
  {
    name: 'users',
    description: 'Team members and user data',
    entities: ENTITIES.filter(e => ['User'].includes(e.name)),
  },
  {
    name: 'invoicing',
    description: 'Invoices and billing',
    entities: ENTITIES.filter(e => ['Invoice', 'Expense'].includes(e.name)),
    enums: ENUMS.filter(e => ['invoice_state'].includes(e.name)),
  },
  {
    name: 'compute',
    description: 'Compute tools (profitability, utilization, aggregation)',
    enums: ENUMS.filter(e => ['profitability_mode', 'group_by'].includes(e.name)),
  },
  {
    name: 'resolution',
    description: 'Entity resolution and rate lookup',
    enums: ENUMS.filter(e => ['entity_type', 'match_type', 'rate_source'].includes(e.name)),
  },
];

/**
 * Get schema information
 */
export function getSchema(params: {
  category?: string;
  entity?: string;
  enum?: string;
}): {
  categories?: SchemaCategory[];
  entity?: EntityDefinition;
  enum?: EnumDefinition;
  available_categories?: string[];
  available_entities?: string[];
  available_enums?: string[];
} {
  // If specific entity requested
  if (params.entity) {
    const entity = ENTITIES.find(e => e.name.toLowerCase() === params.entity!.toLowerCase());
    if (entity) {
      return { entity };
    }
    return {
      available_entities: ENTITIES.map(e => e.name),
    };
  }

  // If specific enum requested
  if (params.enum) {
    const enumDef = ENUMS.find(e => e.name.toLowerCase() === params.enum!.toLowerCase());
    if (enumDef) {
      return { enum: enumDef };
    }
    return {
      available_enums: ENUMS.map(e => e.name),
    };
  }

  // If specific category requested
  if (params.category) {
    const category = SCHEMA_CATEGORIES.find(c => c.name.toLowerCase() === params.category!.toLowerCase());
    if (category) {
      return { categories: [category] };
    }
    return {
      available_categories: SCHEMA_CATEGORIES.map(c => c.name),
    };
  }

  // Return full schema overview
  return {
    categories: SCHEMA_CATEGORIES,
    available_entities: ENTITIES.map(e => e.name),
    available_enums: ENUMS.map(e => e.name),
  };
}
