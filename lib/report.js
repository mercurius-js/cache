'use strict'

class Report {
  constructor (opts) {
    this.logReport = opts.logReport || this.defaultLog
    this.logInterval = opts.logInterval
    this.logTimer = null
    this.data = {}

    this.init(opts)
  }

  init (opts) {
    this.log = opts.app.log
    const schema = opts.app.graphql.schema
    const fields = opts.all
      ? Object.keys(schema.getQueryType().getFields()).map(field => `Query.${field}`)
      : this.getPolicies(opts.policy)

    for (const field of fields) {
      this.data[field] = {}
      this.data[field].dedupes = 0
      this.data[field].hits = 0
      this.data[field].misses = 0
      this.data[field].skips = 0
    }
  }

  getPolicies (policies) {
    const fields = []
    for (const policy of Object.keys(policies)) {
      if (policy === 'Mutation' || policy === 'Subscription') {
        continue
      }

      for (const field of Object.keys(policies[policy])) {
        fields.push(`${policy}.${field}`)
      }
    }
    return fields
  }

  clear () {
    for (const item of Object.keys(this.data)) {
      this.data[item].dedupes = 0
      this.data[item].hits = 0
      this.data[item].misses = 0
      this.data[item].skips = 0
    }
  }

  defaultLog () {
    this.log && this.log.info({ data: this.data }, 'mercurius-cache report')
  }

  logReportAndClear () {
    this.logReport(this.data)
    this.clear()
  }

  refresh () {
    this.logTimer = setInterval(() => this.logReportAndClear(), this.logInterval * 1000).unref()
  }

  close () {
    // istanbul ignore next
    if (!this.logTimer) { return }
    clearInterval(this.logTimer)
  }

  wrap ({ name, onDedupe, onHit, onMiss, onSkip }) {
    this[name] = {
      onDedupe: () => {
        this.data[name].dedupes++
        onDedupe()
      },
      onHit: () => {
        this.data[name].hits++
        onHit()
      },
      onMiss: () => {
        this.data[name].misses++
        onMiss()
      },
      onSkip: () => {
        this.data[name].skips++
        onSkip()
      }
    }
  }
}

function createReport ({ app, all, policy, logInterval, logReport }) {
  if (!logInterval || !((policy && policy.Query) || all)) {
    const disabled = {
      clear: noop,
      refresh: noop,
      close: noop,
      wrap: ({ name, onDedupe, onHit, onMiss, onSkip }) => {
        disabled[name] = { onDedupe, onHit, onMiss, onSkip }
      }
    }
    return disabled
  }

  return new Report({ app, all, policy, logInterval, logReport })
}

function noop () { }

module.exports = createReport
