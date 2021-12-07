
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
    const fields = opts.all ? Object.keys(schema.getQueryType().getFields()) : Object.keys(opts.policy.Query)

    for (const field of fields) {
      const name = 'Query.' + field
      this.data[name] = {}
      this.data[name].dedupes = 0
      this.data[name].hits = 0
      this.data[name].misses = 0
      this.data[name].skips = 0
    }
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
