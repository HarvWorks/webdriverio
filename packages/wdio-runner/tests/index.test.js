import fs from 'fs'

import WDIORunner from '../src'

jest.mock('fs')
jest.mock('util', () => ({ promisify: (fn) => fn }))

describe('wdio-runner', () => {
    describe('_fetchDriverLogs', () => {
        let runner
        beforeEach(() => {
            runner = new WDIORunner()
            runner.cid = '0-1'
        })
        it('not do anything if driver does not support log commands', async () => {
            global.browser = { sessionId: '123' }

            const result = await runner._fetchDriverLogs({ outputDir: '/foo/bar' }, ['*'])
            expect(result).toBe(undefined)
        })

        it('should not write to file if all logs excluded', async () => {
            global.browser = {
                getLogTypes: () => Promise.resolve(['foo', 'bar']),
                getLogs: (type) => Promise.resolve([`#1 ${type} log`, `#2 ${type} log`]),
                sessionId: '123'
            }

            await runner._fetchDriverLogs({ outputDir: '/foo/bar' }, ['*'])

            expect(fs.writeFile).toHaveBeenCalledTimes(0)
        })

        it('should not write to file excluded logTypes', async () => {
            global.browser = {
                getLogTypes: () => Promise.resolve(['foo', 'bar']),
                getLogs: (type) => Promise.resolve([`#1 ${type} log`, `#2 ${type} log`]),
                sessionId: '123'
            }

            await runner._fetchDriverLogs({ outputDir: '/foo/bar' }, ['bar'])

            expect(fs.writeFile).toHaveBeenCalledTimes(1)

            expect(fs.writeFile.mock.calls[0]).toEqual(['/foo/bar/wdio-0-1-foo.log', '"#1 foo log"\n"#2 foo log"', 'utf-8'])
        })

        it('should fetch logs', async () => {
            global.browser = {
                getLogTypes: () => Promise.resolve(['foo', 'bar']),
                getLogs: (type) => Promise.resolve([`#1 ${type} log`, `#2 ${type} log`]),
                sessionId: '123'
            }

            await runner._fetchDriverLogs({ outputDir: '/foo/bar' })
            expect(fs.writeFile.mock.calls[0]).toEqual(['/foo/bar/wdio-0-1-foo.log', '"#1 foo log"\n"#2 foo log"', 'utf-8'])
            expect(fs.writeFile.mock.calls[1]).toEqual(['/foo/bar/wdio-0-1-bar.log', '"#1 bar log"\n"#2 bar log"', 'utf-8'])
        })

        it('should not fail if logs can not be received', async () => {
            global.browser = {
                getLogTypes: () => Promise.resolve(['corrupt']),
                getLogs: () => Promise.reject(new Error('boom')),
                sessionId: '123'
            }

            await runner._fetchDriverLogs({ outputDir: '/foo/bar' })
            expect(fs.writeFile).toHaveBeenCalledTimes(0)
        })

        it('should not write to file if no logs exist', async () => {
            global.browser = {
                getLogTypes: () => Promise.resolve(['foo', 'bar']),
                getLogs: () => Promise.resolve([]),
                sessionId: '123'
            }

            await runner._fetchDriverLogs({ outputDir: '/foo/bar' })
            expect(fs.writeFile.mock.calls).toHaveLength(0)
        })

        afterEach(() => {
            fs.writeFile.mockClear()
        })
    })

    describe('endSession', () => {
        it ('should work normally when called after framework run', async () => {
            const hook = jest.fn()
            const runner = new WDIORunner()
            runner._shutdown = jest.fn()
            global.browser = {
                deleteSession: jest.fn(),
                sessionId: '123',
                config: { afterSession: [hook] }
            }
            await runner.endSession()
            expect(hook).toBeCalledTimes(1)
            expect(global.browser.deleteSession).toBeCalledTimes(1)
            expect(!global.browser.sessionId).toBe(true)
            expect(runner._shutdown).toBeCalledTimes(0)
        })

        it('should do nothing when triggered by run method without session', async () => {
            const hook = jest.fn()
            const runner = new WDIORunner()
            runner._shutdown = jest.fn()
            await runner.endSession()
            expect(hook).toBeCalledTimes(0)
        })

        it('should wait for session to be created until shutting down', async () => {
            const hook = jest.fn()
            const runner = new WDIORunner()
            runner._shutdown = jest.fn()
            global.browser = {
                deleteSession: jest.fn(),
                config: { afterSession: [hook] }
            }
            setTimeout(() => {
                global.browser.sessionId = 123
            }, 200)

            const start = Date.now()
            await runner.endSession(true)
            const end = Date.now()
            expect(hook).toBeCalledTimes(1)
            expect(global.browser.deleteSession).toBeCalledTimes(1)
            expect(!global.browser.sessionId).toBe(true)
            expect(runner._shutdown).toBeCalledTimes(1)
            expect(end - start).toBeGreaterThanOrEqual(200)
        })
    })

    describe('run', () => {
        it('should fail if log file is corrupted', async () => {
            const runner = new WDIORunner()
            runner._shutdown = jest.fn()
            runner.configParser.addConfigFile = jest.fn().mockImplementation(
                () => { throw new Error('boom') })
            await runner.run({})

            expect(runner._shutdown).toBeCalledWith(1)
        })

        it('should fail if init session fails', async () => {
            const runner = new WDIORunner()
            const beforeSession = jest.fn()
            const caps = { browserName: '123' }
            const specs = ['foobar']
            const config = {
                reporters: [],
                beforeSession: [beforeSession]
            }
            runner.configParser.getConfig = jest.fn().mockReturnValue(config)
            runner._shutdown = jest.fn()
            runner._initSession = jest.fn().mockReturnValue(null)
            await runner.run({
                argv: { reporters: [] },
                cid: '0-0',
                caps,
                specs
            })

            expect(runner._shutdown).toBeCalledWith(1)
            expect(beforeSession).toBeCalledWith(config, caps, specs)
        })

        it('should return failures count', async () => {
            const runner = new WDIORunner()
            const config = {
                framework: 'testNoFailures',
                reporters: [],
                beforeSession: []
            }
            runner.configParser.getConfig = jest.fn().mockReturnValue(config)
            runner._initSession = jest.fn().mockReturnValue({ options: { capabilities: {} } })
            const failures = await runner.run({ argv: {}, caps: {} })

            expect(failures).toBe(0)
        })

        it('should call browser url if args watch', async () => {
            const runner = new WDIORunner()
            const config = {
                framework: 'testNoFailures',
                reporters: [],
                beforeSession: []
            }
            runner.configParser.getConfig = jest.fn().mockReturnValue(config)
            global.browser = { url: jest.fn(url => url) }
            runner._initSession = jest.fn().mockReturnValue({ options: { capabilities: {} } })
            const failures = await runner.run({ argv: { watch: true }, caps: {} })

            expect(failures).toBe(0)
            expect(global.browser.url).toBeCalledWith('about:blank')
        })

        it('should set failures to 1 in case of error', async () => {
            const runner = new WDIORunner()
            const config = {
                framework: 'testThrows',
                reporters: [],
                beforeSession: []
            }
            runner.configParser.getConfig = jest.fn().mockReturnValue(config)
            runner._initSession = jest.fn().mockReturnValue({ options: { capabilities: {} } })
            runner.emit = jest.fn()
            const failures = await runner.run({ argv: {}, caps: {} })

            expect(failures).toBe(1)
            expect(runner.emit.mock.calls[0]).toEqual(['error', new Error('framework testThrows failed')])
        })

        it('should return if sigintWasCalled', async () => {
            const runner = new WDIORunner()
            const caps = { browserName: '123' }
            const specs = ['foobar']
            const config = {
                framework: 'testThrows',
                reporters: [],
                beforeSession: []
            }
            runner.configParser.getConfig = jest.fn().mockReturnValue(config)
            runner._shutdown = jest.fn()
            runner.endSession = jest.fn()
            runner._initSession = jest.fn().mockReturnValue({})
            runner.sigintWasCalled = true
            await runner.run({
                argv: { reporters: [] },
                cid: '0-0',
                caps,
                specs
            })

            expect(runner.endSession).toBeCalledTimes(1)
            expect(runner._shutdown).toBeCalledWith(0)
        })
    })

    describe('_initSession', () => {
        it('should register browser to global scope', async () => {
            const runner = new WDIORunner()
            const browser = await runner._initSession(
                { hostname: 'foobar' },
                [{ browserName: 'chrome' }]
            )

            expect(browser).toBe(global.browser)
            expect(typeof $).toBe('function')
            expect(typeof $$).toBe('function')

            expect(browser.$).toBeCalledTimes(0)
            expect(browser.$$).toBeCalledTimes(0)
            /* eslint-disable-next-line */
            $('foobar')
            /* eslint-disable-next-line */
            $$('barfoo')
            expect(browser.$).toBeCalledTimes(1)
            expect(browser.$$).toBeCalledTimes(1)
        })

        it('should register before and after command listener', async () => {
            const reporter = { emit: jest.fn() }
            const runner = new WDIORunner()

            runner.reporter = reporter
            const browser = await runner._initSession(
                { hostname: 'foobar' },
                [{ browserName: 'chrome' }]
            )

            const beforeListener = browser.on.mock.calls[0]
            expect(beforeListener[0]).toBe('command')
            beforeListener[1]({ foo: 'bar' })
            expect(reporter.emit).toBeCalledWith(
                'client:beforeCommand',
                { foo: 'bar', sessionId: 'fakeid' })

            reporter.emit.mockClear()

            const afterListener = browser.on.mock.calls[1]
            expect(afterListener[0]).toBe('result')
            afterListener[1]({ bar: 'foo' })
            expect(reporter.emit).toBeCalledWith(
                'client:afterCommand',
                { bar: 'foo', sessionId: 'fakeid' })
        })

        it('should return null if initiating session fails', async () => {
            global.throwRemoteCall = true
            const runner = new WDIORunner()
            runner.emit = jest.fn()
            const browser = await runner._initSession(
                { hostname: 'foobar' },
                [{ browserName: 'chrome' }]
            )

            expect(browser).toBe(null)
            expect(runner.emit).toBeCalledWith('error', new Error('boom'))
        })

        afterEach(() => {
            global.throwRemoteCall = undefined

            if (global.browser) {
                global.browser.on.mockClear()
                global.browser = undefined
                global.$ = undefined
                global.$$ = undefined
            }
        })
    })

    describe('_shutdown', () => {
        it('should emit exit', async () => {
            const runner = new WDIORunner()
            runner.reporter = { waitForSync: jest.fn()
                .mockReturnValue(Promise.resolve()) }
            runner.emit = jest.fn()

            expect(await runner._shutdown(123)).toBe(123)
            expect(runner.reporter.waitForSync).toBeCalledTimes(1)
            expect(runner.emit).toBeCalledWith('exit', 1)
        })
    })

    afterEach(() => {
        delete global.browser
    })
})
