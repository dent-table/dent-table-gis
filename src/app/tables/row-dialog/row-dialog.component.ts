import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  Inject,
  OnDestroy,
  OnInit
} from '@angular/core';
import {DatabaseService} from '../../providers/database.service';
import {TableDefinition} from '../../model/model';
import {
  AbstractControl,
  AsyncValidatorFn,
  FormBuilder,
  FormGroup,
  ValidationErrors,
  Validators
} from '@angular/forms';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';
import * as moment from 'moment';
import {Utils} from '../../commons/Utils';
import * as _ from 'lodash-es';
import {LoggerService} from '../../providers/logger.service';
import {Observable, Subscription, timer} from "rxjs";
import {map, switchMap, tap} from "rxjs/operators";
import {ShowOnDirtyErrorStateMatcher} from "@angular/material/core";

export interface DialogData {
  tableId: any;
  element?: any;
  tableDefinition?: TableDefinition;
  availableSlots?: number[];
}

@Component({
  selector: 'app-row-dialog',
  templateUrl: './row-dialog.component.html',
  styleUrls: ['./row-dialog.component.scss'],
})
export class RowDialogComponent implements OnInit, AfterViewInit, OnDestroy {
  logTag = RowDialogComponent.name;

  tableDefinition: TableDefinition;
  availableSlots: number[];
  formGroup: FormGroup;

  error;

  dialogType: string;
  specialCases;

  /** Show mat-error when invalid control is dirty, touched, or submitted.
   * https://stackoverflow.com/questions/51456487/why-mat-error-not-get-displayed-inside-mat-form-field-in-angular-material-6-with
   */
  dirtyMatcher = new ShowOnDirtyErrorStateMatcher();

  /* caching validation observables subscription */
  statusChangeObservable: Subscription;
  validationUserNameObservable: Subscription;
  currentValidationId: number;
  currentValidationUser: string;
  searchUserPending: boolean;


  validationUserAsyncValidator(): AsyncValidatorFn {
    return (control: AbstractControl): Observable<ValidationErrors | null> => {
      return timer(300).pipe(switchMap((index, value) => {
        return this.databaseService.getValidationUserName(Number.parseInt(control.value, 10)).pipe(
          map(res => {
            return res ? null : {id_exists: false};
          }),
          tap(() => setTimeout(() => this.cdr.detectChanges(), 0))
        );
      }));
    };
  }

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: DialogData,
    private dialogRef: MatDialogRef<RowDialogComponent>,
    private databaseService: DatabaseService,
    private cdr: ChangeDetectorRef,
    private fb: FormBuilder,
    private logger: LoggerService
  ) {
    if ('string' === typeof data.tableId) {
      this.data.tableId = Number.parseInt(this.data.tableId, 10);
    }

    if (this.data.element && this.data.element['table_ref']) {
      this.dialogType = 'update';
    } else {
      this.dialogType = 'insert';
    }
  }

  ngOnInit() {
    this.tableDefinition = this.data.tableDefinition;

    if (this.data.element.validation_name) {
      this.currentValidationUser = this.data.element.validation_name;
      this.currentValidationId = this.data.element.validation_id;
    }

    if (!this.tableDefinition) {
      this.databaseService.getTableDefinition(this.data.tableId).toPromise().then((values => {
        this.tableDefinition = values;
        this.createFormGroup();
      }));
    } else {
      this.createFormGroup();
    }

    this.specialCases = _.keys(Utils.getSpecialCases(this.data.tableId));

  }

  ngAfterViewInit(): void {
    this.availableSlots = this.data.availableSlots ? this.data.availableSlots : [];

    if (this.dialogType === 'update' && this.data.element['slot_number'] && !Utils.specialCase(this.data.element['slot_number'], this.data.tableId)) {
      this.availableSlots.push(this.data.element['slot_number']);
    }

    if (!this.data.availableSlots) {
      this.databaseService.getAvailableSlots(this.data.tableId).toPromise().then((values) => {
        this.availableSlots = this.availableSlots.concat(values);
      });
    }
  }

  ngOnDestroy(): void {
    this.logger.debug(this.logTag, "Destroying observables.. ")
    if (this.validationUserNameObservable) { this.validationUserNameObservable.unsubscribe(); }
    if (this.statusChangeObservable) { this.statusChangeObservable.unsubscribe(); }
  }

  typeOf = Utils.typeof;

  createFormGroup() {
    const disablingControls = {}; // controls in this group will be disabled if validated_by field is not valid

    let elementSlotNumber = this.data.element ? this.data.element['slot_number'] : '';
    // check if slot number is one of special cases
    elementSlotNumber = Utils.specialCase(elementSlotNumber, this.data.tableId) === false
      ? elementSlotNumber
      : Utils.specialCase(elementSlotNumber, this.data.tableId);

    disablingControls['slot_number'] = this.fb.control(elementSlotNumber);

    for (const column of this.tableDefinition.columnsDefinition) {
      const validators = [];
      const asyncValidators = [];

      let currentValue = this.data.element ? this.data.element[column.name] : '';

      if (currentValue && column.type.name === 'date' && currentValue !== '') {
        currentValue = moment(currentValue);
      } else if (column.type.name === 'date' && column.required) {
        currentValue = moment();
      }
      if (column.required) {
        validators.push(Validators.required);
      }

      // special columns needs something else
      if (column.type.special) {
        if (column.name === 'validated_by') {
          // validated_by field needs that the inserted id exists into database
          asyncValidators.push(this.validationUserAsyncValidator());
        }
      }

      // group[column.name] = new FormControl(currentValue || '',
      //   {validators: validators, asyncValidators: asyncValidators, updateOn: "change"});

      disablingControls[column.name] = this.fb.control(currentValue || '',
        {validators: validators, asyncValidators: asyncValidators, updateOn: "change"});
    }

    // we have to remove validated_by field from the control group
    const validatedByControl: AbstractControl = disablingControls['validated_by'];
    delete disablingControls['validated_by'];

    this.statusChangeObservable = validatedByControl.statusChanges.subscribe(status => this.enableFormIfValid(status));

    this.formGroup = this.fb.group({
      validated_by: validatedByControl,
      disablingControls: this.fb.group(disablingControls)
    });

    if (!this.currentValidationUser) {
      this.formGroup.get(['disablingControls']).disable();
    }
    this.cdr.detectChanges();
  }

  onInsert() {
    if (this.formGroup.valid) {
      const values = this.formGroup.value;
      _.merge(values, values.disablingControls);
      delete values.disablingControls;

      this.databaseService.insertRow(this.data.tableId, values).toPromise().then((result) => {
        this.dialogRef.close(result);
      }).catch((error) => {
        this.logger.error(this.logTag, error);
        this.error = error;
      });
    }
  }

  onUpdate() {
    const toUpdate = {};
    let someDirty = false;
    if (this.formGroup.valid && this.formGroup.dirty) {
      const controlPaths = Utils.controlsPaths(this.formGroup);
      for (let controlPath of controlPaths) {
        if (this.formGroup.get(controlPath).dirty && this.formGroup.get(controlPath).valid) {
          someDirty = true;
          // control name is the last element of the path
          toUpdate[controlPath[controlPath.length - 1]] = this.formGroup.get(controlPath).value;
        }
      }

      if (someDirty) {
        this.databaseService.updateRow(this.data.tableId, this.data.element.table_ref, toUpdate).toPromise().then((result) => {
          this.dialogRef.close(result);
        }).catch((error) => {
          this.logger.error(this.logTag, error);
          this.error = error;
        });
      }
    }
  }

  onSubmit() {
    switch (this.dialogType) {
      case 'insert': this.onInsert(); break;
      case 'update': this.onUpdate(); break;
    }
  }



  /* printFormGroupStatus() {
     const controlsStatus = {};
     const keys = Object.keys(this.formGroup.controls);
     for (const k of keys) {
       const control: AbstractControl = this.formGroup.controls[k];
       controlsStatus[k] = {valid: control.valid, pristine: control.pristine, dirty: control.dirty,
       touched: control.touched, untouched: control.untouched, status: control.status};
     }

     return controlsStatus;
   }*/

  enableFormIfValid(status: string) {
    this.searchUserPending = status === 'PENDING';

    if (status === 'INVALID') {
      this.disableForm();
    } else if (status === 'VALID') {
      this.enableForm();
    }
  }

  private enableForm() {
    const form = this.formGroup.get('disablingControls');
    const formValue = Number.parseInt(this.formGroup.get('validated_by').value);

    if (formValue !== this.currentValidationId) {
      if (this.validationUserNameObservable) {
        this.validationUserNameObservable.unsubscribe();
      }
      this.currentValidationId = formValue;
      this.validationUserNameObservable = this.databaseService.getValidationUserName(this.currentValidationId).subscribe(
        (value => {
            if (value) {
              this.currentValidationUser = value;
              form.enable();
              this.cdr.detectChanges();
            }
          }
        )
      );
    }
  }

  disableForm(): void {
    const form = this.formGroup.get('disablingControls');

    if (!this.validationUserNameObservable?.closed) { this.validationUserNameObservable?.unsubscribe(); }
    this.currentValidationId = null;
    this.currentValidationUser = null;
    form.disable();
  }

}
