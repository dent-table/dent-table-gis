import {
  AfterViewInit,
  Component,
  ElementRef,
  HostBinding,
  Input,
  OnDestroy,
  OnInit,
  Optional,
  Self,
  ViewChild
} from '@angular/core';
import {
  AbstractControl,
  AsyncValidatorFn,
  ControlValueAccessor,
  FormBuilder,
  FormControl,
  FormControlDirective,
  NgControl,
  ValidationErrors
} from "@angular/forms";
import {Observable, of, Subject, Subscription, timer} from "rxjs";
import {map, switchMap} from "rxjs/operators";
import {DatabaseService} from "../../../providers/database.service";
import {MatFormField, MatFormFieldControl} from "@angular/material/form-field";
import {FocusMonitor} from "@angular/cdk/a11y";
import {coerceBooleanProperty} from "@angular/cdk/coercion";
import {ShowOnDirtyErrorStateMatcher} from "@angular/material/core";

@Component({
  selector: 'app-validation-input',
  template: `
    <div (click)="input.focus()" style="cursor: text;">
      <div class="inline" style="width: 35%">
        <input #input type="text" [formControl]="control" minlength="0" maxlength="4"
               [attr.aria-labelledby]="parentFormField?.getLabelId()" [id]="id"/>
      </div>
      <div class="inline flex" style="width: 60%; cursor: text" (click)="focus()">
        <span *ngIf="validationUserName" class="validation-name">{{validationUserName}}</span>
        <mat-spinner diameter="14" *ngIf="validationPending"></mat-spinner>
      </div>
    </div>
  `,
  styles: [`
    .inline {
      display: inline-block;
    }

    .flex {
      display: inline-flex;
      justify-content: flex-end;
    }

    input {
      border: none;
      background: none;
      padding: 0;
      outline: none;
      font: inherit;
      color: currentColor;
    }
  `],
  providers: [{provide: MatFormFieldControl, useExisting: ValidationInputComponent}]
})
export class ValidationInputComponent implements MatFormFieldControl<string>, ControlValueAccessor, OnDestroy, OnInit, AfterViewInit {
  static nextId = 0;

  validationUserName;
  validationPending: boolean;
  validationObservable: Subscription;
  formControl: FormControl;

  focused = false;
  stateChanges = new Subject<void>();

  private _placeholder: string;
  private _required = false;
  private _disabled = false;

  controlType = 'validation-input';

  get control() {
    return this.formControl
  }
  @Input()
  get value(): string | null {
    // return val.length === 4 ? val : null;
    return this.formControl.value;
  }
  set value(val: string | null) {
    val = val || '';
    this.formControl.setValue(val);
    if (this._onChange) this._onChange(val);
    this.stateChanges.next();
  }

  @Input()
  get placeholder(): string | null {
    return this._placeholder;
  }
  set placeholder(placeholder) {
    this._placeholder = placeholder;
    this.stateChanges.next();
  }

  @Input()
  get required() {
    return this._required;
  }
  set required(req) {
    this._required = coerceBooleanProperty(req);
    this.stateChanges.next();
  }

  @Input()
  get disabled(): boolean {
    return this._disabled;
  }
  set disabled(value: boolean) {
    this._disabled = coerceBooleanProperty(value);
    this.disabled ? this.control.disable() : this.control.enable();
    this.setDisabled();
    this.stateChanges.next();
  }

  @Input('aria-describedby') userAriaDescribedBy: string;

  get errorState(): boolean {
    return (this.ngControl.errors !== null || this.control.errors !== null);
  }

  // ControlValueAccessor elements
  @ViewChild(FormControlDirective, {static: true})
  formControlDirective: FormControlDirective;

  @Input()
  formControlName: string;

  @ViewChild('input', {static: true, read: ElementRef})
  inputElementRef: ElementRef;

  @HostBinding() id = `validation-input-${ValidationInputComponent.nextId++}`;

  @HostBinding('class.floating')
  get shouldLabelFloat() {
    return this.focused || !this.empty;
  }

  get empty() {
    return !this.control.value;
  }

  @HostBinding('attr.aria-describedby') describedBy = '';
  setDescribedByIds(ids: string[]) {
    this.describedBy = ids.join(' ');
  }

  // onContainerClick(event: MouseEvent) {
  //   if ((event.target as Element).tagName.toLowerCase() != 'input') {
  //     this.elRef.nativeElement.querySelector('input').focus();
  //   }
  // }

  onContainerClick(event: MouseEvent) {
    if(!this.disabled) {
      this._onTouched();
    }
  }

  /** Show mat-error when invalid control is dirty, touched, or submitted
   * (by default mat-error would be showed only when control is touched).
   * https://stackoverflow.com/questions/51456487/why-mat-error-not-get-displayed-inside-mat-form-field-in-angular-material-6-with
   */
  dirtyMatcher = new ShowOnDirtyErrorStateMatcher();

  constructor(
    @Optional() @Self() public ngControl: NgControl,
    private fb: FormBuilder,
    private fm: FocusMonitor,
    private elRef: ElementRef<HTMLElement>,
    @Optional() public parentFormField: MatFormField,
    private databaseService: DatabaseService,
  ) {
    this.formControl = this.fb.control('');
    this.setDisabled();

    if (this.ngControl != null) {
      // Setting the value accessor directly (instead of using
      // the providers) to avoid running into a circular import.
      this.ngControl.valueAccessor = this;
    }

    fm.monitor(elRef, true).subscribe(origin => {
      this.focused = !this.disabled && !!origin;
      this.stateChanges.next();
    });
  }

  ngOnInit() {
    this.formControl.valueChanges.subscribe(
      () => {
        const value = this.value;
        if(this._onChange) this._onChange(value);
        this.stateChanges.next();
      }
    );
  }

  ngAfterViewInit() {
    if (this.ngControl && this.ngControl.control) {
      this.ngControl.control.setAsyncValidators(this.validationUserAsyncValidator());
      this.validationObservable = this.ngControl.statusChanges.pipe(switchMap(value => {
        if (value === "VALID" && this.ngControl.dirty) {
          return this.databaseService.getValidationUserName(Number.parseInt(this.value, 10));
        }
        return of(value);
      })).subscribe( (res) => {
        this.validationPending = res === "PENDING";
        this.validationUserName = (res !== "PENDING" && res !== "INVALID") ? res : null;
      });

      if (this.ngControl.valid) {
        this.validationPending = true;
        this.databaseService.getValidationUserName(Number.parseInt(this.ngControl.value, 10)).subscribe((value) => {
          this.validationUserName = value;
          this.validationPending = false;
        });
      }
    }
  }

  ngOnDestroy() {
    this.stateChanges.complete();
    this.fm.stopMonitoring(this.elRef.nativeElement);
    if (this.validationObservable) {
      this.validationObservable.unsubscribe();
    }
  }

  // ControlValueAccessor interface methods
  clearInput(): void {
    this.formControl.setValue('');
  }
  writeValue(obj: any): void {
    this.value = obj;
  }

  _onChange: (_:any) => void;
  registerOnChange(fn: any): void {
    this._onChange = fn;
  }

  _onTouched: () => void;
  registerOnTouched(fn: any): void {
    this._onTouched = fn;
  }
  setDisabledState?(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  private setDisabled() {
    if(this.disabled && this.control) {
      this.control.disable();
    } else if(this.control) {
      this.control.enable();
    }
  }

  validationUserAsyncValidator(): AsyncValidatorFn {
    return (control: AbstractControl): Observable<ValidationErrors | null> => {
      return timer(300).pipe(switchMap((index, value) => {
        if (!control.value) return of(null); // if control is empty there is nothing to validate
        if (control.value.length < 4) return of({id_exists: false}); // if id is less than 4 character is invalid
        return this.databaseService.getValidationUserName(Number.parseInt(control.value, 10)).pipe(
          map(res => {
            return (res) ? null : {id_exists: false};
          })
        );
      }));
    };
  }

  focus() {
    if (!this.disabled) {
      this.inputElementRef.nativeElement.focus();
    }
  }
}
