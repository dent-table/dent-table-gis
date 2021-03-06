import {NgModule} from '@angular/core';
import {CommonModule} from '@angular/common';
import {MaterialModule} from '../material/material.module';
import {TableWidgetComponent} from './table-widget/table-widget.component';
import {TranslateModule} from '@ngx-translate/core';
import {TablePageComponent} from './table-page/table-page.component';
import {RowDialogComponent} from './row-dialog/row-dialog.component';
import {FormsModule, ReactiveFormsModule} from '@angular/forms';
import {SharedModule} from '../shared/shared.module';
import {DragAndDropModule} from 'angular-draggable-droppable';

@NgModule({
  declarations: [TableWidgetComponent, TablePageComponent, RowDialogComponent],
  exports: [
    TableWidgetComponent
  ],
  imports: [
    CommonModule, MaterialModule, TranslateModule, ReactiveFormsModule,
    FormsModule, SharedModule, DragAndDropModule
  ],
  // entry<Components is no longer required wit Ivy,
  // see https://material.angular.io/components/dialog/overview#configuring-dialog-content-via-entrycomponents
  // entryComponents: [ RowDialogComponent, ConfirmDialogComponent ]
})
export class TablesModule { }
