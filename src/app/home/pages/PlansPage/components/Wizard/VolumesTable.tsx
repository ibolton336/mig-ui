import React, { useEffect } from 'react';
import {
  TextContent,
  Text,
  TextVariants,
  Popover,
  PopoverPosition,
  Title,
  Button,
  EmptyState,
  EmptyStateVariant,
  EmptyStateIcon,
  EmptyStateBody,
  Grid,
  GridItem,
  Pagination,
  PaginationVariant,
  Level,
  LevelItem,
} from '@patternfly/react-core';
import {
  sortable,
  TableComposable,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  IRowData,
} from '@patternfly/react-table';
import ReactJson from 'react-json-view';
import ExclamationTriangleIcon from '@patternfly/react-icons/dist/js/icons/exclamation-triangle-icon';
import spacing from '@patternfly/react-styles/css/utilities/Spacing/spacing';
import SimpleSelect, { OptionWithValue } from '../../../../../common/components/SimpleSelect';
import { useFilterState, useSortState } from '../../../../../common/duck/hooks';
import { IFormValues, IOtherProps } from './WizardContainer';
import {
  FilterToolbar,
  FilterCategory,
  FilterType,
} from '../../../../../common/components/FilterToolbar';
import { capitalize } from '../../../../../common/duck/utils';
import TableEmptyState from '../../../../../common/components/TableEmptyState';
import { IPlanPersistentVolume, PvCopyMethod } from '../../../../../plan/duck/types';
import { usePaginationState } from '../../../../../common/duck/hooks/usePaginationState';
import { useFormikContext } from 'formik';
import { useSelector } from 'react-redux';
import { DefaultRootState } from '../../../../../../configureStore';

const styles = require('./VolumesTable.module').default;

const VolumesTable: React.FunctionComponent<IOtherProps> = () => {
  const planState = useSelector((state: DefaultRootState) => state.plan);

  const { setFieldValue, values } = useFormikContext<IFormValues>();

  const updatePersistentVolumeAction = (currentPV: IPlanPersistentVolume, option: any) => {
    if (planState.currentPlan !== null && values.persistentVolumes) {
      const newPVs = [...values.persistentVolumes];
      const matchingPV = values.persistentVolumes.find((pv) => pv === currentPV);
      const pvIndex = values.persistentVolumes.indexOf(matchingPV);

      newPVs[pvIndex] = {
        ...matchingPV,
        selection: {
          ...matchingPV.selection,
          //if updating the copy method, then assume the action will be set to copy
          ...(option.type === 'copyMethod'
            ? {
                copyMethod: option.value,
                action: 'copy',
              }
            : option.value === 'move' && {
                action: 'move',
              }),
        },
      };
      setFieldValue('persistentVolumes', newPVs);
    }
  };

  const columns = [
    { title: 'PV name', transforms: [sortable] },
    { title: 'Claim', transforms: [sortable] },
    { title: 'Namespace', transforms: [sortable] },
    { title: 'Storage class', transforms: [sortable] },
    { title: 'Size', transforms: [sortable] },
    { title: 'PV migration type', transforms: [sortable] },
    { title: 'Details' },
  ];
  const getSortValues = (pv: any) => [
    pv.name,
    pv.claim,
    pv.project,
    pv.storageClass,
    pv.size,
    pv.type,
  ];
  const filterCategories: FilterCategory[] = [
    {
      key: 'name',
      title: 'PV name',
      type: FilterType.search,
      placeholderText: 'Filter by PV name...',
    },
    {
      key: 'claim',
      title: 'Claim',
      type: FilterType.search,
      placeholderText: 'Filter by claim...',
    },
    {
      key: 'project',
      title: 'Namespace',
      type: FilterType.search,
      placeholderText: 'Filter by namespace...',
    },
    {
      key: 'storageClass',
      title: 'Storage class',
      type: FilterType.search,
      placeholderText: 'Filter by storage class...',
    },
    {
      key: 'type',
      title: 'PV migration type',
      type: FilterType.select,
      selectOptions: [
        { key: 'filesystem', value: 'Filesystem copy' },
        { key: 'move', value: 'Move' },
        { key: 'snapshot', value: 'Snapshot copy' },
      ],
    },
  ];

  const { filterValues, setFilterValues, filteredItems } = useFilterState(
    values.persistentVolumes,
    filterCategories
  );

  const { sortBy, onSort, sortedItems } = useSortState(filteredItems, getSortValues);
  const { currentPageItems, setPageNumber, paginationProps } = usePaginationState(sortedItems, 10);
  useEffect(() => setPageNumber(1), [filterValues, sortBy]);

  useEffect(() => {
    //select all pvs on load
    setAllRowsSelected(true);
    const newSelected = filteredItems.map((pv) => pv.name);
    setFieldValue('selectedPVs', newSelected);
  }, []);

  const [allRowsSelected, setAllRowsSelected] = React.useState(false);

  const onSelectAll = (event: any, isSelected: boolean, rowIndex: number, rowData: IRowData) => {
    setAllRowsSelected(isSelected);

    let newSelected;
    if (isSelected) {
      newSelected = filteredItems.map((pv) => pv.name); // Select all (filtered)
    } else {
      newSelected = []; // Deselect all
    }
    setFieldValue('selectedPVs', newSelected);
  };

  const onSelect = (event: any, isSelected: boolean, rowIndex: number, rowData: IRowData) => {
    if (allRowsSelected) {
      setAllRowsSelected(false);
    }
    let newSelected;
    if (rowIndex === -1) {
      if (isSelected) {
        newSelected = filteredItems.map((pv) => pv.name); // Select all (filtered)
      } else {
        newSelected = []; // Deselect all
      }
    } else {
      const { props } = rowData;
      if (isSelected) {
        newSelected = [...new Set([...props.meta.selectedPVs, props.cells[0]])];
      } else {
        newSelected = props.meta.selectedPVs.filter(
          (selected: string) => selected !== props.cells[0]
        );
      }
    }
    setFieldValue('selectedPVs', newSelected);
  };

  const rows = currentPageItems.map((pv: IPlanPersistentVolume) => {
    const matchingPVResource = planState.pvResourceList.find(
      (pvResource) => pvResource.name === pv.name
    );

    const copyMethodToString = (copyMethod: PvCopyMethod) => {
      if (copyMethod === 'filesystem') return 'Filesystem copy';
      if (copyMethod === 'snapshot') return 'Volume snapshot';
      return copyMethod && capitalize(copyMethod);
    };

    const copyMethodOptions: OptionWithValue<any>[] = pv?.supported?.copyMethods.map(
      (copyMethod: PvCopyMethod) => ({
        value: copyMethod,
        toString: () => copyMethodToString(copyMethod),
        type: 'copyMethod',
      })
    );

    const migrationTypeOptions: OptionWithValue[] = pv?.supported?.actions.map((action) => ({
      value: action,
      toString: () => capitalize(action),
      type: 'action',
    }));

    const combinedCopyOptions = migrationTypeOptions
      .concat(copyMethodOptions)
      .filter((option) => option.value !== 'copy' && option.value !== 'skip');

    const currentSelectedCopyOption = combinedCopyOptions.find(
      (option) => option.value === pv.selection.action || option.value === pv.selection.copyMethod
    );

    let sourcePVCName = pv.pvc.name;
    const includesMapping = sourcePVCName.includes(':');
    if (includesMapping) {
      const mappedPVCNameArr = sourcePVCName.split(':');
      sourcePVCName = mappedPVCNameArr[0];
    }

    return {
      cells: [
        pv.name,
        sourcePVCName,
        pv.pvc.namespace,
        pv.storageClass,
        pv.capacity,
        {
          title: (
            <SimpleSelect
              id="select-migration-type"
              aria-label="Select pv migration type"
              onChange={(option: any) => updatePersistentVolumeAction(pv, option)}
              options={combinedCopyOptions}
              value={currentSelectedCopyOption}
              placeholderText={null}
            />
          ),
        },
        {
          title: (
            <Popover
              className={styles.jsonPopover}
              position={PopoverPosition.bottom}
              bodyContent={
                matchingPVResource ? (
                  <ReactJson src={matchingPVResource} enableClipboard={false} />
                ) : (
                  <EmptyState variant={EmptyStateVariant.small}>
                    <EmptyStateIcon icon={ExclamationTriangleIcon} />
                    <Title headingLevel="h5" size="md">
                      No PV data found
                    </Title>
                    <EmptyStateBody>Unable to retrieve PV data</EmptyStateBody>
                  </EmptyState>
                )
              }
              aria-label="pv-details"
              closeBtnAriaLabel="close-pv-details"
              maxWidth="200rem"
            >
              <Button isDisabled={planState.isFetchingPVResources} variant="link">
                View JSON
              </Button>
            </Popover>
          ),
        },
      ],
      selected: values.selectedPVs.includes(pv.name),
      meta: {
        selectedPVs: values.selectedPVs,
        id: pv.name,
      },
    };
  });

  return (
    <Grid hasGutter>
      <GridItem>
        <TextContent>
          <Text component={TextVariants.p}>
            Choose to move or copy persistent volumes associated with selected namespaces.
          </Text>
        </TextContent>
      </GridItem>
      <GridItem>
        <Level>
          <LevelItem>
            <FilterToolbar
              filterCategories={filterCategories}
              filterValues={filterValues}
              setFilterValues={setFilterValues}
            />
          </LevelItem>
          <LevelItem>
            <Pagination
              widgetId="pv-table-pagination-top"
              itemCount={paginationProps.itemCount}
              perPage={paginationProps.perPage}
              page={paginationProps.page}
              onSetPage={paginationProps.onSetPage}
              onPerPageSelect={paginationProps.onPerPageSelect}
            />
          </LevelItem>
        </Level>
        {rows.length > 0 ? (
          <TableComposable aria-label="Selectable Table">
            <Thead>
              <Tr>
                <Th
                  width={10}
                  select={{
                    onSelect: onSelectAll,
                    isSelected: allRowsSelected,
                  }}
                />
                <Th width={20}>{columns[0].title}</Th>
                <Th width={10}>{columns[1].title}</Th>
                <Th width={10}>{columns[2].title}</Th>
                <Th width={10}>{columns[3].title}</Th>
                <Th width={10}>{columns[4].title}</Th>
                <Th width={10}>{columns[5].title}</Th>
                <Th width={10}>{columns[6].title}</Th>
                <Th width={20}></Th>
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((row, rowIndex) => {
                return (
                  <Tr key={rowIndex}>
                    <Td
                      key={`${rowIndex}_0`}
                      select={{
                        rowIndex,
                        onSelect,
                        isSelected: row.selected,
                        props: row,
                      }}
                    />
                    {row.cells.map((cell, cellIndex) => {
                      const shiftedIndex = cellIndex + 1;
                      console.log('cell', cell);
                      return (
                        <Td
                          key={`${rowIndex}_${shiftedIndex}`}
                          dataLabel={columns[cellIndex].title}
                        >
                          {typeof cell !== 'string' ? cell.title : cell}
                        </Td>
                      );
                    })}
                  </Tr>
                );
              })}
            </Tbody>
          </TableComposable>
        ) : (
          <TableEmptyState
            onClearFiltersClick={() => setFilterValues({})}
            isHiddenActions={values.persistentVolumes.length === 0}
            titleText={values.persistentVolumes.length === 0 && 'No persistent volumes found'}
            bodyText={
              values.persistentVolumes.length === 0 &&
              'No persistent volumes are attached to the selected projects. Click Next to continue.'
            }
          />
        )}
        <Pagination
          widgetId="pv-table-pagination-bottom"
          variant={PaginationVariant.bottom}
          className={spacing.mtMd}
          itemCount={paginationProps.itemCount}
          perPage={paginationProps.perPage}
          page={paginationProps.page}
          onSetPage={paginationProps.onSetPage}
          onPerPageSelect={paginationProps.onPerPageSelect}
        />
      </GridItem>
    </Grid>
  );
};

export default VolumesTable;
