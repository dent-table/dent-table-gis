import {FormControl, FormGroupDirective, NgForm} from "@angular/forms";
import {ErrorStateMatcher} from "@angular/material/core";

/** Show mat-error when invalid control is dirty, touched, or submitted.
 * https://stackoverflow.com/questions/51456487/why-mat-error-not-get-displayed-inside-mat-form-field-in-angular-material-6-with
 */
export class MyErrorStateMatcher implements ErrorStateMatcher {
  isErrorState(control: FormControl | null, form: FormGroupDirective | NgForm | null): boolean {
    const isSubmitted = form && form.submitted;
    return !!(control && control.invalid && (control.dirty || control.touched || isSubmitted));
  }
}
