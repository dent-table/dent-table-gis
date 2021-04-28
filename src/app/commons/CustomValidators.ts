import {AbstractControl, AsyncValidatorFn, ValidationErrors} from "@angular/forms";
import {Observable, of, timer} from "rxjs";
import {map, switchMap} from "rxjs/operators";
import {DatabaseService} from "../providers/database.service";

export class CustomValidators {
  static validationUserAsyncValidator(databaseService: DatabaseService): AsyncValidatorFn {
    return (control: AbstractControl): Observable<ValidationErrors | null> => {
      return timer(300).pipe(switchMap((index, value) => {
        return databaseService.getValidationUserName(Number.parseInt(control.value, 10)).pipe(map(res => {
          return res ? null : {id_exists: false};
        }));
      }));
    };
  }
}
