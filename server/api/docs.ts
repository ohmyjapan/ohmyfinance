// server/api/docs.ts
import { defineEventHandler, setHeader } from 'h3'

const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'OhMyFinance API',
    description: 'API documentation for OhMyFinance personal finance management',
    version: '1.0.0',
    contact: {
      name: 'OhMyFinance Support'
    }
  },
  servers: [
    { url: '/api', description: 'API Server' }
  ],
  tags: [
    { name: 'Transactions', description: 'Transaction management' },
    { name: 'Receipts', description: 'Receipt management' },
    { name: 'Budgets', description: 'Budget tracking' },
    { name: 'Invoices', description: 'Invoice generation' },
    { name: 'Recurring', description: 'Recurring payments' },
    { name: 'Vendors', description: 'Vendor management' },
    { name: 'Reports', description: 'Financial reports' },
    { name: 'Webhooks', description: 'Webhook configuration' }
  ],
  paths: {
    '/transactions': {
      get: {
        tags: ['Transactions'],
        summary: 'List all transactions',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'source', in: 'query', schema: { type: 'string' } },
          { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' } }
        ],
        responses: {
          '200': {
            description: 'List of transactions',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    transactions: { type: 'array', items: { $ref: '#/components/schemas/Transaction' } },
                    pagination: { $ref: '#/components/schemas/Pagination' }
                  }
                }
              }
            }
          }
        }
      },
      post: {
        tags: ['Transactions'],
        summary: 'Create a new transaction',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/TransactionCreate' }
            }
          }
        },
        responses: {
          '200': { description: 'Transaction created' }
        }
      }
    },
    '/transactions/{id}': {
      get: {
        tags: ['Transactions'],
        summary: 'Get a transaction by ID',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          '200': { description: 'Transaction details' },
          '404': { description: 'Transaction not found' }
        }
      },
      put: {
        tags: ['Transactions'],
        summary: 'Update a transaction',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          '200': { description: 'Transaction updated' }
        }
      },
      delete: {
        tags: ['Transactions'],
        summary: 'Delete a transaction',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          '200': { description: 'Transaction deleted' }
        }
      }
    },
    '/transactions/bulk': {
      post: {
        tags: ['Transactions'],
        summary: 'Bulk operations on transactions',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  action: { type: 'string', enum: ['delete', 'update_status', 'add_tag', 'remove_tag'] },
                  ids: { type: 'array', items: { type: 'string' } },
                  value: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Bulk operation completed' }
        }
      }
    },
    '/budgets': {
      get: {
        tags: ['Budgets'],
        summary: 'List all budgets',
        responses: {
          '200': { description: 'List of budgets with spending data' }
        }
      },
      post: {
        tags: ['Budgets'],
        summary: 'Create a new budget',
        responses: {
          '200': { description: 'Budget created' }
        }
      }
    },
    '/invoices': {
      get: {
        tags: ['Invoices'],
        summary: 'List all invoices',
        responses: {
          '200': { description: 'List of invoices' }
        }
      },
      post: {
        tags: ['Invoices'],
        summary: 'Create a new invoice',
        responses: {
          '200': { description: 'Invoice created' }
        }
      }
    },
    '/invoices/{id}/pdf': {
      get: {
        tags: ['Invoices'],
        summary: 'Generate invoice PDF',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          '200': { description: 'HTML invoice for printing' }
        }
      }
    },
    '/reports/tax': {
      get: {
        tags: ['Reports'],
        summary: 'Generate tax report',
        parameters: [
          { name: 'year', in: 'query', schema: { type: 'integer' } },
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'csv'] } }
        ],
        responses: {
          '200': { description: 'Tax report data' }
        }
      }
    },
    '/webhooks': {
      get: {
        tags: ['Webhooks'],
        summary: 'List all webhooks',
        responses: {
          '200': { description: 'List of webhooks' }
        }
      },
      post: {
        tags: ['Webhooks'],
        summary: 'Create a new webhook',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  url: { type: 'string', format: 'uri' },
                  events: { type: 'array', items: { type: 'string' } },
                  secret: { type: 'string' }
                },
                required: ['name', 'url']
              }
            }
          }
        },
        responses: {
          '200': { description: 'Webhook created' }
        }
      }
    },
    '/backup': {
      get: {
        tags: ['System'],
        summary: 'Download full backup',
        responses: {
          '200': { description: 'JSON backup file' }
        }
      }
    },
    '/backup/restore': {
      post: {
        tags: ['System'],
        summary: 'Restore from backup',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description: 'Backup data'
              }
            }
          }
        },
        responses: {
          '200': { description: 'Restore completed' }
        }
      }
    }
  },
  components: {
    schemas: {
      Transaction: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          reference: { type: 'string' },
          date: { type: 'string', format: 'date-time' },
          amount: { type: 'number' },
          currency: { type: 'string', default: 'JPY' },
          status: { type: 'string', enum: ['pending', 'completed', 'failed', 'refunded'] },
          source: { type: 'string' },
          customer: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string' }
            }
          },
          tags: { type: 'array', items: { type: 'string' } }
        }
      },
      TransactionCreate: {
        type: 'object',
        required: ['amount', 'date', 'customer'],
        properties: {
          amount: { type: 'number' },
          date: { type: 'string', format: 'date' },
          customer: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string' }
            }
          },
          status: { type: 'string' },
          source: { type: 'string' },
          notes: { type: 'string' }
        }
      },
      Pagination: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          limit: { type: 'integer' },
          total: { type: 'integer' },
          totalPages: { type: 'integer' }
        }
      }
    }
  }
}

export default defineEventHandler(async (event) => {
  const accept = event.node.req.headers.accept || ''

  // Return HTML documentation page
  if (accept.includes('text/html')) {
    setHeader(event, 'Content-Type', 'text/html')
    return `
<!DOCTYPE html>
<html>
<head>
  <title>OhMyFinance API Documentation</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/docs',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout'
    })
  </script>
</body>
</html>
    `
  }

  // Return OpenAPI JSON
  return openApiSpec
})
