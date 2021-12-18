import { Service, State } from 'iw-base/lib/registry';
import * as logging from 'iw-base/lib/logging';
import { IwDeepstreamClient } from 'iw-base/modules/deepstream-client';
import { Component, Inject, Scoped } from 'iw-ioc';
import { Record } from '@deepstream/client/dist/src/record/record';
import { List } from '@deepstream/client/dist/src/record/list';
import { CronJob } from 'cron';
import { includes } from 'lodash';
import moment, { Moment } from 'moment';
import { EVENT } from '@deepstream/client/dist/src/constants';

const log = logging.getLogger('Cron');

const CRON_ROOT = 'cron';
const RECORD_LIST_PATH = 'iw-introspection/records/' + CRON_ROOT + '/.iw-index';

export interface CronDefinition {
  cron?: string;
  on?: string;

  setRecord?: RecordOperation;
  updateRecord?: RecordOperation;
  deleteRecord?: string;

  call?: CallOperation;
  emit?: EventOperation;
}

export interface CallOperation {
  name: string;
  data: any;
}

export interface RecordOperation {
  name: string;
  data: { [key: string]: any };
}

export interface EventOperation {
  name: string;
  data: any;
}

@Component('cron')
@Scoped()
@Inject([IwDeepstreamClient])
export class Cron extends Service {

  private listRecord: List;
  private readonly records: Map<string, Record> = new Map();
  private readonly cronJobs: Map<string, CronJob> = new Map();

  constructor(private ds: IwDeepstreamClient) {
    super('cron');

  }

  async start() {
    await this.subscribeToListOfCronJobs();
    this.setState(State.OK);
  }

  async stop() {
    for (const job of this.cronJobs.values()) {
      job.stop();
    }
    this.cronJobs.clear();

    for (const record of this.records.values()) {
      record.discard();
    }
    this.records.clear();

    this.listRecord.discard();
    this.listRecord = undefined;
    this.setState(State.INACTIVE);
  }

  private async subscribeToListOfCronJobs() {
    this.listRecord = this.ds.getList(RECORD_LIST_PATH);
    this.listRecord.subscribe((entries) => {
      this.updateCronJobs(entries);
    });
    this.listRecord.on(EVENT.RECORD_DELETED, () => {
      log.debug('cron job index record deleted. resubscribing ...');
      process.nextTick(() => this.subscribeToListOfCronJobs());
    });
    await this.listRecord.whenReady();
    log.debug({ path: RECORD_LIST_PATH }, 'successfully subscribed to cron jobs');
    this.updateCronJobs(this.listRecord.getEntries());
  }

  private updateCronJobs(recordNames: string[]) {
    log.debug({ recordNames }, 'updating cron jobs');
    for (const recordName of recordNames) {
      if ( ! this.records.has(recordName)) {
        const record = this.ds.getRecord(CRON_ROOT + '/' + recordName);
        this.records.set(recordName, record);
        record.subscribe((data) => this.createCronJob(recordName, data), true);
      }
    }

    for (const recordName of this.records.keys()) {
      if ( ! includes(recordNames, recordName)) {
        this.records.get(recordName).discard();
        this.records.delete(recordName);
        if (this.cronJobs.has(recordName)) {
          this.cronJobs.get(recordName).stop();
          this.cronJobs.delete(recordName);
          log.info('Removed cron job ' + recordName);
        }
      }
    }
  }

  private createCronJob(name: string, definition: CronDefinition) {
    if (this.cronJobs.has(name)) {
      this.cronJobs.get(name).stop();
      this.cronJobs.delete(name);
    }

    let cronTime: string | Moment;
    if (definition.on) {
      cronTime = moment(definition.on);
    } else if (definition.cron) {
      cronTime = definition.cron;
    } else {
      log.error('Invalid cron definition ' + name + ': either "on" or "cron" attribute is required.');
      return;
    }

    const cronJob = new CronJob(cronTime, async () => {
      if (definition.call) {
        log.debug({ name: definition.call.name, data: definition.call.data }, 'Calling RPC ' + definition.call.name);
        this.ds.makeRpc(definition.call.name, definition.call.data, (err) => {
          if (err) {
            log.error(err, 'RPC Call to ' + definition.call.name + ' failed');
          }
        });
      }

      if (definition.emit) {
        log.debug({ name: definition.emit.name, data: definition.emit.data }, 'Triggering Event ' + definition.emit.name);
        this.ds.emitEvent(definition.emit.name, definition.emit.data);
      }

      if (definition.setRecord) {
        log.debug({ name: definition.setRecord.name, data: definition.setRecord.data }, 'Setting Record ' + definition.setRecord.name);
        const record = this.ds.getRecord(definition.setRecord.name);
        await record.whenReady();
        await record.setWithAck(definition.setRecord.data);
        record.discard();
      }
      if (definition.updateRecord) {
        log.debug({ name: definition.updateRecord.name, data: definition.updateRecord.data }, 'Updating Record ' + definition.updateRecord.name);
        const record = this.ds.getRecord(definition.updateRecord.name);
        await record.whenReady();
        for (const [key, value] of Object.entries(definition.updateRecord.data)) {
          await record.setWithAck(key, value);
        }
        record.discard();
      }
      if (definition.deleteRecord) {
        log.debug({ name: definition.deleteRecord }, 'Deleting Record ' + definition.deleteRecord);
        const record = this.ds.getRecord(definition.deleteRecord);
        await record.whenReady();
        record.delete();
        record.discard();
      }
    }, undefined, true);

    this.cronJobs.set(name, cronJob);

    log.info('Created cron job ' + name);
  }
}
