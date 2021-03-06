import {AfterViewInit, Component, NgZone, OnInit, QueryList, ViewChild, ViewChildren} from '@angular/core';
import {CellClickEvent, TableWidgetComponent} from '../../tables/table-widget/table-widget.component';
import {RowDialogComponent} from '../../tables/row-dialog/row-dialog.component';
import {DatabaseService} from '../../providers/database.service';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {openSnackbar} from '../../commons/Utils';
import {LoggerService} from '../../providers/logger.service';
import {TranslateService} from '@ngx-translate/core';
import {ConfirmDialogComponent} from '../confirm-dialog/confirm-dialog.component';
import {QuestionnaireComponent} from '../questionnaire/questionnaire.component';
import {updateVerifiedColumn} from '../../tables/common/TableUtils';
import {TableRow} from '../../model/model';
import {PreferencesService} from "../../providers/preferences.service";

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit {
  logTag = HomeComponent.name;

  @ViewChildren(TableWidgetComponent) tables: QueryList<TableWidgetComponent>;

  orderColumns: {[tableId: string]: string};

  constructor(
    private databaseService: DatabaseService,
    private zone: NgZone,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private logger: LoggerService,
    private translateService: TranslateService,
    private preferencesService: PreferencesService,
  ) { }

  ngOnInit(): void {
    this.orderColumns = this.preferencesService.get(
      PreferencesService.CATEGORIES.tables,
      PreferencesService.PREFERENCES_KEYS.tables.order_columns
    );
  }

  cellClicked(tableId: number, event: CellClickEvent): void {
    const el = event.element;
    const colName = event.columnName;

    if (event.columnName === 'verified') {
      this.logger.info(this.logTag, 'Updating verified column...');
      updateVerifiedColumn(el, this.databaseService).subscribe({
        next: value => {
          this.logger.info(this.logTag, `Update result`, value);
          this.reloadTable(tableId);
        },
        error: error => this.logger.error(this.logTag, 'Update error', error)
      });
    } else if (colName === 'delete_row') {
      this.zone.run(() => {
        const dialogRef = this.dialog.open(ConfirmDialogComponent, {data: {title: 'PAGES.CONFIRM_DIALOG.SURE'}});
        dialogRef.afterClosed().subscribe((result) => {
          if (result) {
            this.deleteRow(tableId, el);
          }
        });
      });
    } else if (event.columnName ==='open_questionnaires') {
      this.openQuestionnaireDialog(tableId, event.element);
    }
    else {
      this.openRowDialog(tableId, event.element);
    }
  }

  openQuestionnaireDialog(tableId: number, element: TableRow): void {
    this.zone.run(() => {
      this.dialog.open(QuestionnaireComponent, {
        data: {tableId: tableId, element: element},
        width: '40%', height: '90%'
      });
    });
  }

  openRowDialog(tableId: number, element?: any): void {
    let dialogRef;

    // component' onInit not fired without Zone
    this.zone.run(() => {
      dialogRef = this.dialog.open(RowDialogComponent, {
        data: { tableId: tableId, element: element },
        width: '40%', height: '90%'
      });

      dialogRef.afterClosed().subscribe((result) => {
        this.logger.debug(this.logTag, 'Dialog closed', result);
        if (result && result !== 'canceled' && result.changes > 0) {
          this.reloadTable(tableId);
        }
      });
    });
  }

  deleteRow(tableId: number, el: any): void {
    this.logger.debug(this.logTag, 'deleting', el);
    let snackbarText, snackbarDuration, snackbarActionText, snackbarActionCallback, snackbarRef;

    this.databaseService.deleteRow(el.table_id, el.slot_number).subscribe({
      next: (result) => {
        this.logger.debug(this.logTag, result);
        this.logger.debug(this.logTag, result.date, typeof result.date);
        this.logger.debug(this.logTag, "Delete result", result);
        snackbarText = this.translateService.instant("SUCCESSES.DELETE");
        snackbarDuration = 5000;
        snackbarActionText = this.translateService.instant("COMMONS.CANCEL");
        snackbarActionCallback = () => {
          this.logger.info(this.logTag, "Delete undo requested");
          result["slot_number"] = el.slot_number;
          this.logger.debug(result);
          this.databaseService.insertRow(tableId, result).subscribe({
            next: () => {
              this.logger.info(this.logTag, "Delete undo success");
              this.reloadTable(tableId);
            },
            error: (error2) => {
              this.logger.error(this.logTag, "Delete undo error!", error2);
            }
          });
          snackbarRef.dismiss();
        };

        this.zone.run(() => {
          snackbarRef = openSnackbar(
            this.snackBar, snackbarText, snackbarDuration, snackbarActionText, snackbarActionCallback);
        });
        this.reloadTable(tableId);
      },
      error: (errors) => {
        this.logger.error(this.logTag, "Delete error!", errors);
        snackbarText = this.translateService.instant("ERRORS.GENERIC");
        snackbarDuration = 3000;
        openSnackbar(
          this.snackBar, snackbarText, snackbarDuration);
      },
    });
  }

  reloadTable(tableId: number): void {
    for (let i = 0; i < this.tables.length; i++) {
      const table = this.tables.get(i);

      if (table.tableId === tableId) {
        table.reload();
        break;
      }
    }
  }
}
