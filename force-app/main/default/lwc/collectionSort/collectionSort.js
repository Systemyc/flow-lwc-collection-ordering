import { LightningElement, api, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { getRecord } from 'lightning/uiRecordApi';
import { getObjectInfo } from "lightning/uiObjectInfoApi";

export default class CollectionSort extends LightningElement {
	labels = {
		loading: "Loading",
		error: "Error",
		noData: "There is no data to sort",
		reorder: "Reorder"
	};

	_inputCollection;
	@api get inputCollection() { return this._inputCollection} set inputCollection(value) { this._inputCollection = value; this.processInput(); }
	_outputCollection;
	@api get outputCollection() { return this._outputCollection; }
	@api fieldList;
	@api headerField;
	@api sortField;
    @api sortFieldIsString;
	@api icon;
	@api showIndex;

	isLoading = true;
	firstRecordId;
	objectApiName;
	metadata;
	error;
	items = [];

	// for drag&drop
	_dragging;
	_itemElements;
	_draggedElement;
	_dragEndMethod;
	_currentY;
    _menuTop;
    _menuBottom;
	_initialY;
	_initialScrollHeight;
	_draggedIndex;
	_hoveredIndex;
	_initialDraggedIndex;
	_scrollStep;
	_scrollingInterval;
	_currentItemDraggedHeight;

	connectedCallback() {

	}

	disconnectedCallback() {
        window.removeEventListener('mouseup', this._dragEndMethod);
        window.removeEventListener('touchend', this._dragEndMethod);
    }

	@wire(getRecord, { recordId: '$firstRecordId', layoutTypes: "Compact" })
	getRecordWired(result) {
		const {data, error} = result;

		if(data) {
			this.objectApiName = data.apiName;
		}
		else if(error) {
			console.error(error);
			this.error = error;
			this.dispatchEvent(
				new ShowToastEvent({
					title: this.labels.error,
					message: error,
					variant: "error"
				})
			);

			this.isLoading = false;
		}
	}

	@wire(getObjectInfo, { objectApiName: '$objectApiName' })
	getObjectInfoWire(result) {
		const {data, error} = result;

		if(data) {
			this.metadata = data;
			this.processInput();
		}
		else if(error) {
			console.error(error);
			this.error = error;
			this.dispatchEvent(
				new ShowToastEvent({
					title: this.labels.error,
					message: error,
					variant: "error"
				})
			);

		}

		this.isLoading = false;
	}

	get displayIndex() {
		if(this.showIndex === undefined) return true;
		return this.showIndex;
	}

	get hasData() {
		return this.inputCollection && this.inputCollection.length > 0;
	}

	processInput() {
		if(!this.hasData) return;

		const firstRecord = this.inputCollection[0];
		this.firstRecordId = firstRecord.Id;

		if(!this.metadata) return;

		let fieldList = [];
		if(!this.fieldList) { // if no list of fields have been given, then use all the fields in the passed collection
			for (let property in firstRecord) {
				if(property !== "Id") fieldList.push(property);
			}
		}
		else {
			fieldList = this.fieldList.split(',');
		}

		let sortFieldLabel = null;

		let inputItems = [...this.inputCollection];
		if(this.sortField) {
			inputItems.sort((a, b) => {
				let aValue = a[this.sortField];
				if(aValue === '') aValue = null;
                if(this.sortFieldIsString && aValue != null) aValue = Number(aValue);

				let bValue = b[this.sortField];
				if(bValue === '') bValue = null;
                if(this.sortFieldIsString && bValue != null) bValue = Number(bValue);

				if(aValue != null && bValue == null) return -1;
				if(aValue == null && bValue != null) return 1;
				if(aValue == null && bValue == null) return 0;

				if(aValue < bValue) return -1;
				if(aValue > bValue) return 1;
				return 0;
			});

			sortFieldLabel = this.metadata.fields[this.sortField]?.label;
		}

		let index = 0;

		this.items = inputItems.map(item => {
			let header = item.Id;
			if(this.headerField && item[this.headerField]) header = item[this.headerField];

			let fields = [];

			fieldList.forEach(fieldName => {
				const value = item[fieldName];
				const label = this.metadata.fields[fieldName]?.label;
				if(label) fields.push({ value: value, name: fieldName, label: label});
			});

			return {
				id: item.Id,
				header: header,
				record: item,
				fields: fields,
				index: index++,
                visualIndex: index,
				originalIndex: this.sortField ? `${this.labels.originalIndex}: ${sortFieldLabel} = ${item[this.sortField]}` : null
			};
		});
	}

	// for drag&drop

	get listContainer() {
        return this.template.querySelector(
            '[data-element-id="list-container"]'
        );
    }

	// in the case the user loses control of the dragged element, clicking anywhere will reset the list.
    handleListClick() {
        if (this._draggedElement) {
            this.clearSelection();
            this._scrollStep = 0;
        }
    }

	initPositions(event) {
        if (this.listContainer) {
            let menuPosition = this.listContainer.getBoundingClientRect();
			this._menuTop = menuPosition.top;
			this._menuBottom = menuPosition.bottom;
			this._initialScrollHeight = this.listContainer.scrollHeight;
		}

        this._initialY =
            event.type === 'touchstart'
                ? event.touches[0].clientY
                : event.clientY;
    }

	dragStart(event) {
		this._itemElements = Array.from(
            this.template.querySelectorAll('[data-element-id="item"]')
        );

		this._draggedElement = event.currentTarget;

		this._currentItemDraggedHeight = this.computeItemHeight(event.currentTarget);

		this._draggedIndex = Number(this._draggedElement.dataset.index);
        this._initialDraggedIndex = this._draggedIndex;

		this.initPositions(event);

		this._dragEndMethod = this.dragEnd.bind(this);
        window.addEventListener('mouseup', this._dragEndMethod);
        window.addEventListener('touchend', this._dragEndMethod);
	}

	drag(event) {
        if (!this._draggedElement) {
            return;
        }

        this._dragging = true;

		this._draggedElement.classList.add('sortable_dragged');

		const mouseY = event.type === 'touchmove'
			? event.touches[0].clientY
			: event.clientY;
		const menuTop = this._menuTop;
		const menuBottom = this._menuBottom;

        // Make sure it is not possible to drag the item out of the list
        let currentY;
        if (mouseY < menuTop) {
            currentY = menuTop;
        } else if (mouseY > menuBottom) {
            currentY = menuBottom;
        } else {
            currentY = mouseY;
        }
        this._currentY = currentY;

        if (!this._scrollStep) {
            // Stick the dragged item to the mouse position
            this.animateItems(this._currentY);
        }

        event.stopPropagation();
        this.autoScroll(this._currentY);
	}

	dragEnd() {
        window.removeEventListener('mouseup', this._dragEndMethod);
        window.removeEventListener('touchend', this._dragEndMethod);

        clearInterval(this._scrollingInterval);
        this._scrollingInterval = null;
        this._dragging = false;

        if (!this._draggedElement) {
            return;
        }

        if (this._draggedIndex != null && this._hoveredIndex != null) {
            this.switchWithItem(this._draggedIndex, this._hoveredIndex);
        }

		this.clearSelection();
	}

    switchWithItem(draggedIndex, hoveredIndex) {
        const draggedItem = this.items.splice(draggedIndex, 1)[0];
        this.items.splice(hoveredIndex, 0, draggedItem);

        // Update indexes
        this.items.forEach((item, index) => {
            item.index = index;
            item.visualIndex = index + 1;
        });

        this.items = [...this.items];
        this.resetItemsAnimations();

		const itemsCopy = JSON.parse(JSON.stringify(this.items));

		this._outputCollection = itemsCopy.map(item => {
			let record = item.record;
			if(this.sortField) {
                if(this.sortFieldIsString) record[this.sortField] = '' + (item.index + 1);
                else record[this.sortField] = item.index + 1;
            }
			return record;
		});

        console.log('output', JSON.stringify(this.outputCollection));
    }

	resetItemsAnimations() {
        this._itemElements.forEach((item) => {
            if (item.dataset.moved === 'moved') {
                delete item.dataset.moved;
                item.style.transform = 'translateY(0px)';
            }
        });
    }

	computeItemHeight(itemElement) {
        const list = this.template.querySelector(
            '[data-element-id="list-container"]'
        );
        let rowGap;
        if (list) {
            rowGap = parseInt(getComputedStyle(list).rowGap.split('px')[0], 10);
        }
        return itemElement.offsetHeight + (rowGap || 0);
    }

	clearSelection() {
        // Clean the styles and dataset
        this._itemElements.forEach((item, index) => {
            item.style = undefined;
            item.dataset.index = index;
            item.dataset.elementTempIndex = index;
            delete item.dataset.moved;
        });
        if (this._draggedElement) {
            this._draggedElement.classList.remove('sortable_dragged');
        }

        // Clean the tracked variables
        this._draggedElement =
            this._draggedIndex =
            this._hoveredIndex =
            this._initialY =
                null;
    }

	animateItems(currentY) {
        if (currentY && this._draggedElement) {
            this._draggedElement.style.transform = `translate( 0px, ${
                currentY - this._initialY
            }px)`;

            const hoveredItem = this.getHoveredItem(currentY);
            if (hoveredItem) {
                this.animateHoveredItem(hoveredItem);
            }
        }
    }

	getHoveredItem(cursorY) {
        return this._itemElements.find((item) => {
            if (item !== this._draggedElement) {
                const itemIndex = Number(item.dataset.index);
                const itemPosition = item.getBoundingClientRect();
                const hoverTop = itemPosition.top + 10;
                const hoverBottom = itemPosition.bottom - 10;

                // keep the current hovered item and don't set to null if hovering a gap.
                if (
                    cursorY > hoverTop &&
                    cursorY < hoverBottom &&
                    itemIndex != null
                ) {
                    if (item.dataset.elementTempIndex != null) {
                        this._hoveredIndex = parseInt(
                            item.dataset.elementTempIndex,
                            10
                        );
                    } else {
                        this._hoveredIndex = itemIndex;
                    }
                    return item;
                }
            }
            return undefined;
        });
    }

	animateHoveredItem(hoveredItem) {
        const hoveredIndex = this._hoveredIndex;
        const draggedIndex = this._draggedIndex;
        const hoveredElementIndex = parseInt(hoveredItem.dataset.index, 10);
        const tempHoveredIndex = parseInt(hoveredItem.dataset.elementTempIndex,10);

        // This breaks when the transform is animated with css because the item remains hovered for
        // a few milliseconds, reversing the animation unpredictably.
        const itemHasMoved = hoveredItem.dataset.moved === 'moved';
        const itemHoveringSmallerItem = draggedIndex > hoveredIndex || tempHoveredIndex > hoveredIndex;
        const itemHoveringLargerItem = draggedIndex < hoveredIndex || tempHoveredIndex < hoveredIndex;

        if (itemHasMoved) {
            delete hoveredItem.dataset.moved;
            hoveredItem.style.transform = 'translateY(0px)';
            hoveredItem.dataset.elementTempIndex = hoveredElementIndex;
        } else if (itemHoveringSmallerItem) {
            hoveredItem.dataset.moved = 'moved';
            hoveredItem.style.transform = `translateY(${this._currentItemDraggedHeight}px)`;
            hoveredItem.dataset.elementTempIndex = tempHoveredIndex + 1;
        } else if (itemHoveringLargerItem) {
            hoveredItem.dataset.moved = 'moved';
            hoveredItem.style.transform = `translateY(-${this._currentItemDraggedHeight}px)`;
            hoveredItem.dataset.elementTempIndex = tempHoveredIndex - 1;
        }

        // Get all items in between the dragged and hovered.
        const itemsBetween = this._itemElements.filter((item) => {
            const itemIndex = Number(item.dataset.index);
            const itemMovedAndBetweenDraggedAndHovered =
                ((itemIndex > draggedIndex && itemIndex < hoveredIndex) ||
                    (itemIndex < draggedIndex && itemIndex > hoveredIndex)) &&
                !item.dataset.moved === 'moved';
            if (itemMovedAndBetweenDraggedAndHovered) {
                return item;
            }
            return undefined;
        });

        if (itemsBetween.length) {
            if (draggedIndex > hoveredIndex) {
                itemsBetween.forEach((item) => {
                    const tempIndex = parseInt(
                        item.dataset.elementTempIndex,
                        10
                    );
                    item.dataset.moved = 'moved';
                    item.style.transform = `translateY(${this._currentItemDraggedHeight}px)`;
                    item.dataset.elementTempIndex = tempIndex + 1;
                });
            } else if (draggedIndex < hoveredIndex) {
                itemsBetween.forEach((item) => {
                    const tempIndex = parseInt(
                        item.dataset.elementTempIndex,
                        10
                    );
                    item.dataset.moved = 'moved';
                    item.style.transform = `translateY(-${this._currentItemDraggedHeight}px)`;
                    item.dataset.elementTempIndex = tempIndex - 1;
                });
            }
        }
    }

	autoScroll(currentY) {
        this._scrollStep = this.computeScrollStep(currentY);

        if (!this._scrollingInterval && this._draggedElement) {
            this._scrollingInterval = window.setInterval(() => {
                const overflowY = this.listContainer.scrollHeight > this._initialScrollHeight;

                if (!overflowY) {
                    this.listContainer.scrollBy(0, this._scrollStep);

                    this.animateItems(currentY);

                    this._restrictMotion = true;
                    window.requestAnimationFrame(() => {
                        this._restrictMotion = false;
                    });
                }
            }, 20);
        }

        if (this._scrollStep === 0) {
            window.clearInterval(this._scrollingInterval);
            this._scrollingInterval = null;
        }
    }

	computeScrollStep(currentY) {
        let scrollStep = 0;

        const closeToTop = currentY - this.listContainer.getBoundingClientRect().top < 50;
        const closeToBottom = this.listContainer.getBoundingClientRect().bottom - currentY < 50;
        const scrolledTop = this.listContainer.scrollTop === 0;
        const scrolledBottom = this.listContainer.scrollHeight - this.listContainer.scrollTop === this.listContainer.clientHeight;

        if (closeToTop) {
            scrollStep = -5;
        } else if (closeToBottom) {
            scrollStep = 5;
        }

        if ((scrolledTop && closeToTop) || (scrolledBottom && closeToBottom)) {
            scrollStep = 0;
        }

        return scrollStep;
    }
}