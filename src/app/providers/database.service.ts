import {Injectable, NgZone} from '@angular/core';
import {ElectronService} from './electron.service';
import {Observable, OperatorFunction} from 'rxjs';
import {Questionnaire, QuestionnaireAnswers, TableDefinition} from '../model/model';
import * as crypto from 'crypto';
import {LoggerService} from './logger.service';
import {enterZone} from '../commons/RxjsZone';
import {parseDateString, randomHexString} from '../commons/Utils';
import forEach from 'lodash-es/forEach';
import isBoolean from 'lodash-es/isBoolean';
import isEmpty from 'lodash-es/isEmpty';
import isNil from 'lodash-es/isNil';
import isObjectLike from 'lodash-es/isObjectLike';
import isString from 'lodash-es/isString';
import trim from 'lodash-es/trim';
import isValid from 'date-fns/isValid';

@Injectable({
  providedIn: 'root'
})
export class DatabaseService {
  databaseWebContentId: number;

  algorithm = 'aes-192-cbc';
  password = '3b41iTniwy';

  logTag: string = DatabaseService.name;


  constructor(
    private electronService: ElectronService,
    private loggerService: LoggerService,
    private zone: NgZone,
  ) {
    this.databaseWebContentId = electronService.databaseWebContentId;
  }

  private sendToDatabase(operation: string, data: any, unique?: boolean | number | string) {
    const params = {
      operation: operation,
      parameters: data
    };

    if (unique && typeof unique === 'boolean') {
      params['uid'] = randomHexString(6);
    } else if (unique) {
      params['uid'] = unique;
    }

    this.electronService.ipcSendTo(this.databaseWebContentId, 'database-op', params);
    return unique ? `${operation}-${(params['uid'] as string)}` : operation;
  }

  private encrypt(msg: string) {
    // Use the async `crypto.scrypt()` instead.
    const key = crypto.scryptSync(this.password, 'salt', 24);

    const iv = Buffer.alloc(16, 18);

    // shown here.
    const cipher = crypto.createCipheriv(this.algorithm, key, iv);

    let encrypted = cipher.update(msg, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;

  }

  private valueSanitize(value: any/*, valueName?: string*/) {
    if (isString(value) && isEmpty(trim(value))) {
      value = null;
    } else if (isBoolean(value)) {
      value = value ? 1 : 0;
      // } else if (!isNil(value) && !isNil(valueName) && valueName.indexOf('date') >= 0) {
    } else if (isString(value) && isValid(parseDateString(value))) { // check if value is a string parsable as a valid date
      value = parseDateString(value).valueOf();
    } else if (!isNil(value) && value instanceof Date && isValid(value)) { // check if value is a valid Date object
      value = value.valueOf();
    }

    this.loggerService.debug(this.logTag, value, typeof value);
    return value;
  }

  private valuesSanitize(values: any) {
    if (isObjectLike(values)) {
      // const keys = Object.keys(values);
      // for (const key of keys) {
      //   values[key] = this.valueSanitize(values[key], key);
      // }

      forEach(values, (value, key) => {
        values[key] = this.valueSanitize(value/*, key*/);
      });
    } else {
      values = this.valueSanitize(values);
    }

    return values;
  }

  login(user: string, password: string): Observable<number> {
    const params = {username: user, password: this.encrypt(password)};

    const obs: Observable<number> = new Observable((subscriber) => {
      this.sendToDatabase('login', params);
      this.electronService.ipcOnce('login', (event, response) => {
        if (response.result === 'error') {
          subscriber.error(response.message);
        } else {
          subscriber.next(response.response);
          subscriber.complete();
        }
      });
    });

    return obs.pipe(enterZone(this.zone));
  }

  getAll<R>(tableId: number, limit?: number, orderColumn?: string, mapFun?: OperatorFunction<Array<any>, Array<R>>): Observable<Array<R>> {
    const params = {tableId: tableId};
    if (limit) {
      params['limit'] = limit;
    }
    if (orderColumn) {
      params['orderColumn'] = orderColumn;
    }

    let obs: Observable<R[]> = new Observable((subscriber) => {
      const returnChannel = this.sendToDatabase('table-get-all', params, tableId);
      this.electronService.ipcOnce(returnChannel, (event, data) => {
        if (data.result === 'error') {
          subscriber.error(data.message);
        } else {
          this.electronService.ipcRemoveAllListeners(returnChannel);
          subscriber.next(data.response);
          subscriber.complete();
        }
      });

      return {unsubscribe(): void {}};
    });

    if (mapFun !== undefined) {
      obs = obs.pipe(mapFun);
    }

    return obs.pipe(enterZone(this.zone));
  }

  insertRow(tableId: number, values: any): Observable<any> {
    const params = {tableId: tableId, values: this.valuesSanitize(values)};
    const obs: Observable<any> = new Observable((subscriber => {
      const returnChannel = this.sendToDatabase('table-insert-row', params, tableId);
      this.electronService.ipcOnce(returnChannel, (event, data) => {
        if (data.result === 'error') {
          subscriber.error(data.message);
        } else {
          subscriber.next(data.response);
          subscriber.complete();
        }
      });
    }));

    return obs.pipe(enterZone(this.zone));
  }

  deleteRow(tableId: number, slotNumber: any): Observable<any> {
    const params = {tableId: tableId, slotNumber: slotNumber};
    const obs: Observable<any> = new Observable((subscriber => {
      const returnChannel = this.sendToDatabase('table-delete-row', params, tableId);
      this.electronService.ipcOnce(returnChannel, (event, data) => {
        if (data.result === 'error') {
          subscriber.error(data.message);
        } else {
          subscriber.next(data.response);
          subscriber.complete();
        }
      });
    }));

    return obs.pipe(enterZone(this.zone));
  }

  getTableDefinition(tableId: number): Observable<TableDefinition> {
    const params = {tableId: tableId};

    const obs: Observable<TableDefinition> = new Observable((subscriber) => {
      const returnChannel = this.sendToDatabase('table-get-definition', params, tableId);
      this.electronService.ipcOnce(returnChannel, (event, data) => {
          // if (data.response.id === tableId) {
          if (data.result === 'error') {
            subscriber.error(data.message);
          } else {
            subscriber.next(TableDefinition.create(data.response));
            subscriber.complete();
          }
          // }
        }
      );

      return (() => {});
    });

    return obs.pipe(enterZone(this.zone));
  }

  getAvailableSlots(tableId: number): Observable<number[]> {
    const params = {tableId: tableId};

    const obs: Observable<number[]> = new Observable((subscriber) => {
      const returnChannel = this.sendToDatabase('table-get-available-slots', params, tableId);
      this.electronService.ipcOnce(returnChannel, (event, data) => {
        if (data.result === 'error') {
          subscriber.error(data.message);
        } else {
          subscriber.next(data.response);
          subscriber.complete();
        }
      });
    });

    return obs.pipe(enterZone(this.zone));
  }

  getValidationUserName(validation_userid: number): Observable<string> {
    const params = {userid: validation_userid};

    const obs = new Observable<string>((subscriber => {
      const returnChannel = this.sendToDatabase('validation-get-user-name', params, true);
      this.electronService.ipcOnce(returnChannel, (event, data) => {
        if (data.result == 'error') {
          subscriber.error(data.message);
        } else {
          subscriber.next(data.response.name);
          subscriber.complete();
        }
      });
    }));

    return obs.pipe(enterZone(this.zone));
  }

  moveRow(fromTableId: number, slotNumber: number, toTableId: number): Observable<any> {
    const params = {fromTableId: fromTableId, slotNumber: slotNumber, toTableId: toTableId};

    const obs: Observable<any> = new Observable((subscriber) => {
      // if starting table and target table are same we there's nothing to do
      if (fromTableId === toTableId) {
        subscriber.complete();
        return;
      }

      this.sendToDatabase('move-row', params);
      this.electronService.ipcOnce('move-row', (event, data) => {
        if (data.result === 'error') {
          subscriber.error(data.message);
        } else {
          subscriber.next(data.response);
          subscriber.complete();
        }
      });
    });

    return obs.pipe(enterZone(this.zone));
  }

  updateRow(tableId: number, rowId: number, values: {[name: string]: unknown}): Observable<any> {
    const params = {tableId: tableId, rowId: rowId, values: this.valuesSanitize(values)};

    const obs: Observable<any> = new Observable((subscriber) => {
        const returnChannel = this.sendToDatabase('table-update-row', params, tableId);
        this.electronService.ipcOnce(returnChannel, (event, data) => {
          if (data.result === 'error') {
            subscriber.error(data.message);
          } else {
            subscriber.next(data.response);
            subscriber.complete();
          }
        });
      }
    );

    return obs.pipe(enterZone(this.zone));
  }

  getQuestionnairesBy(tableId: number): Observable<Questionnaire[]> {
    const params = {table_id: tableId};

    const obs: Observable<Questionnaire[]> = new Observable((subscriber) => {
      this.sendToDatabase('questionnaire-get-all', params);
      this.electronService.ipcOnce('questionnaire-get-all', ((event, data) => {
        if (data.result === 'error') {
          subscriber.error(data.message);
        } else {

          subscriber.next(data.response);
          subscriber.complete();
        }
      }));
    });

    return obs.pipe(enterZone(this.zone));
  }

  //TODO: merge this method with the one above
  getQuestionnaireById(questionnaireId: number): Observable<Questionnaire> {
    const params = {questionnaireId};

    const obs: Observable<Questionnaire> = new Observable((subscriber) => {
      this.sendToDatabase('questionnaire-get-by', params);
      this.electronService.ipcOnce('questionnaire-get-by', ((event, data) => {
        if (data.result === 'error') {
          subscriber.error(data.message);
        } else {

          subscriber.next(data.response);
          subscriber.complete();
        }
      }));
    });

    return obs.pipe(enterZone(this.zone));
  }

  saveQuestionnaireAnswers(answersObject: QuestionnaireAnswers): Observable<QuestionnaireAnswers> {
    const obs: Observable<QuestionnaireAnswers> = new Observable((subscriber => {
      this.sendToDatabase('questionnaire-save-answers', answersObject);
      this.electronService.ipcOnce('questionnaire-save-answers', (event, data) => {
        if (data.result === 'error') {
          subscriber.error(data.message);
        } else {
          subscriber.next(data.response);
          subscriber.complete();
        }
      });
    }));

    return obs.pipe(enterZone(this.zone));
  }

  getQuestionnaireAnswersBy(tableId: number, slotNumber: number, questionnaireRef?: number): Observable<{[id: string]: QuestionnaireAnswers[]}> {
    const params = {slot_number: slotNumber, table_id: tableId};
    if (questionnaireRef) {
      params['questionnaire_ref'] = questionnaireRef;
    }

    const obs: Observable<{[id: string]: QuestionnaireAnswers[]}> = new Observable((subscriber) => {
      this.sendToDatabase('questionnaire-get-answers', params);
      this.electronService.ipcOnce('questionnaire-get-answers', ((event, data) => {
        if (data.result === 'error') {
          subscriber.error(data.message);
        } else {
          subscriber.next(data.response);
          subscriber.complete();
        }
      }));
    });

    return obs.pipe(enterZone(this.zone));
  }

  getQuestionnaireAnswerById(questionnaireId: number): Observable<QuestionnaireAnswers> {
    const params = {questionnaireId};

    const obs: Observable<QuestionnaireAnswers> = new Observable((subscriber) => {
      this.sendToDatabase('questionnaire-get-answer-by-id', params);
      this.electronService.ipcOnce('questionnaire-get-answer-by-id', ((event, data) => {
        if (data.result === 'error') {
          subscriber.error(data.message);
        } else {
          subscriber.next(data.response);
          subscriber.complete();
        }
      }));
    });

    return obs.pipe(enterZone(this.zone));
  }
}
