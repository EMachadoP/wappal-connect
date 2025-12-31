# Automated Tests

## Running Tests

### All Tests
```bash
cd tests
npm test
```

### Unit Tests Only
```bash
npm run test:unit
```

### Integration Tests Only
```bash
npm run test:integration
```

### Watch Mode (auto-run on changes)
```bash
npm run test:watch
```

## Test Structure

```
tests/
├── unit/               # Unit tests for individual functions
│   └── create-ticket.test.js
├── integration/        # Integration tests for complete flows
│   └── ticket-creation.test.js
└── package.json        # Test scripts
```

## Test Coverage

### Unit Tests
- ✅ Parameter validation
- ✅ Protocol code format
- ✅ Priority and due_date calculation
- ✅ Error handling

### Integration Tests
- ✅ Complete ticket creation flow
- ✅ Idempotency (prevent duplicates)
- ✅ Condominium fallback from participant
- ✅ Database consistency

## Adding New Tests

1. Create test file in appropriate directory
2. Follow naming convention: `*.test.js`
3. Add script to `package.json` if needed
4. Update this README

## CI/CD Integration

To run tests in CI/CD pipeline:

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: cd tests && npm install
      - run: cd tests && npm test
```
