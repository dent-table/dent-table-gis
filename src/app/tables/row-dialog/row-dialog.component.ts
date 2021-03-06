import {AfterViewInit, ChangeDetectorRef, Component, Inject, OnInit, OnDestroy} from '@angular/core';
import {DatabaseService} from '../../providers/database.service';
import {ColumnDefinition, TableDefinition} from '../../model/model';
import {AbstractControl, FormBuilder, FormGroup, Validators} from '@angular/forms';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';
import {_typeof, controlsPaths, getSpecialCases, specialCase} from '../../commons/Utils';
import {LoggerService} from '../../providers/logger.service';
import parse from 'date-fns/parse';
import {Observable, Subscription, timer} from "rxjs";
import {map, switchMap, tap} from "rxjs/operators";
import {ShowOnDirtyErrorStateMatcher} from "@angular/material/core";
import merge from "lodash-es/merge";

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
  hasValidatedByField: boolean;

  dialogType: string;
  specialCases;

  /* caching validation observables subscription */
  statusChangeObservable: Subscription;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: DialogData,
    private dialogRef: MatDialogRef<RowDialogComponent>,
    private databaseService: DatabaseService,
    private cdr: ChangeDetectorRef,
    private fb: FormBuilder,
    private logger: LoggerService
  ) {
    if (typeof data.tableId === "string") {
      this.data.tableId = Number.parseInt(this.data.tableId, 10);
    }

    if (this.data.element && this.data.element['table_ref']) {
      this.dialogType = 'update';
    } else {
      this.dialogType = 'insert';
    }
  }

  ngOnInit(): void {
    this.tableDefinition = this.data.tableDefinition;

    if (!this.tableDefinition) {
      this.databaseService.getTableDefinition(this.data.tableId).subscribe({
        next: (values) => {
          this.tableDefinition = values;
          this.createFormGroup();
        }
      });
    } else {
      this.createFormGroup();
    }

    this.specialCases = Object.keys(getSpecialCases(this.data.tableId));

  }

  ngAfterViewInit(): void {
    this.availableSlots = this.data.availableSlots ? this.data.availableSlots : [];

    if (this.dialogType === 'update' && this.data.element['slot_number'] && !specialCase(this.data.element['slot_number'], this.data.tableId)) {
      this.availableSlots.push(this.data.element['slot_number']);
    }

    if (!this.data.availableSlots) {
      this.databaseService.getAvailableSlots(this.data.tableId).subscribe({
        next: (values) => {
          this.availableSlots = this.availableSlots.concat(values);
        }
      });
    }
  }

  ngOnDestroy(): void {
    this.logger.debug(this.logTag, "Destroying observables.. ")
    if (this.statusChangeObservable) { this.statusChangeObservable.unsubscribe(); }
  }

  typeOf = _typeof;

  createFormGroup(): void {
    const disablingControls = {}; // controls in this group will be disabled if validated_by field is not valid

    let elementSlotNumber = this.data.element ? this.data.element['slot_number'] : '';
    // check if slot number is one of special cases
    elementSlotNumber = specialCase(elementSlotNumber, this.data.tableId) === false
      ? elementSlotNumber
      : specialCase(elementSlotNumber, this.data.tableId);

    disablingControls['slot_number'] = this.fb.control(elementSlotNumber);

    for (const column of this.tableDefinition.columnsDefinition) {
      const validators = [];
      const asyncValidators = [];

      let currentValue = this.data.element ? this.data.element[column.name] : '';

      if (currentValue && column.type.name === 'date' && currentValue !== '') {
        currentValue = parse(currentValue, 'T', new Date());
      } else if (column.type.name === 'date' && column.required) {
        currentValue = new Date();
      }
      if (column.required) {
        validators.push(Validators.required);
      }

      // special columns needs something else
      // uncomment this block when will be necessary
      // if (column.type.special) {
      //
      // }

      // group[column.name] = new FormControl(currentValue || '',
      //   {validators: validators, asyncValidators: asyncValidators, updateOn: "change"});

      disablingControls[column.name] = this.fb.control(currentValue || '',
        {validators: validators, asyncValidators: asyncValidators, updateOn: "change"});
    }

    this.hasValidatedByField = Object.keys(disablingControls).includes("validated_by");
    console.log(this.hasValidatedByField);

    if (this.hasValidatedByField) {
      // we have to remove validated_by field from the control group
      const validatedByControl: AbstractControl = disablingControls['validated_by'];
      delete disablingControls['validated_by'];

      this.statusChangeObservable = validatedByControl.statusChanges.subscribe(status => this.enableFormIfValid(status));

      this.formGroup = this.fb.group({
        validated_by: validatedByControl,
        disablingControls: this.fb.group(disablingControls)
      });

      // this.cdr.detectChanges();
      this.enableFormIfValid(this.formGroup.status);
    } else {
      this.formGroup = this.fb.group({
        disablingControls: this.fb.group(disablingControls)
      });
    }
  }

  onInsert(): void {
    if (this.formGroup.valid) {
      const values = this.formGroup.value;
      merge(values, values.disablingControls);
      delete values.disablingControls;

      this.databaseService.insertRow(this.data.tableId, values).subscribe({
        next: (result) => {
          this.dialogRef.close(result);
        },
        error: (error) => {
          this.logger.error(this.logTag, error);
          this.error = error;
        }
      });
    }
  }

  onUpdate(): void {
    const toUpdate = {};
    let someDirty = false;
    if (this.formGroup.valid && this.formGroup.dirty) {
      const controlPaths = controlsPaths(this.formGroup);
      for (const controlPath of controlPaths) {
        if (this.formGroup.get(controlPath).dirty && this.formGroup.get(controlPath).valid) {
          someDirty = true;
          // control name is the last element of the path
          toUpdate[controlPath[controlPath.length - 1]] = this.formGroup.get(controlPath).value;
        }
      }

      if (someDirty) {
        this.databaseService.updateRow(this.data.tableId, this.data.element.table_ref, toUpdate).subscribe({
          next: (result) => {
            this.dialogRef.close(result);
          },
          error: (error) => {
            this.logger.error(this.logTag, error);
            this.error = error;
          }
        });
      }
    }
  }

  onSubmit(): void {
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
    if (status === 'INVALID') {
      this.formGroup.get('disablingControls').disable();
    } else if (status === 'VALID') {
      this.formGroup.get('disablingControls').enable();
    }
  }

  getDropdownItemStyle(column: ColumnDefinition, opt: { name: string, value: any }): any {
    if (column.name === "text_color") return {backgroundColor: opt.value, color: 'whitesmoke'};

    return {};
  }
}
