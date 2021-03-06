import SearchIndex from 'appkit/utils/search-index';

export default Ember.ArrayController.extend({
  sortProperties : ['itemData._sort_create_date'],
  sortAscending  : false,

  contentType: null,

  lockedItems: Ember.A([]),
  lockedRef  : null,

  searchQuery: null,
  isSearchResults: false,

  recordLimit: 0,
  endReached: false,

  isLimited: function () {
    return this.get('content.length') >= this.get('recordLimit') && !this.get('endReached') && !this.get('isSearchResults');
  }.property('content.length', 'endReached', 'isSearchResults'),

  filterQuery: '',

  columnChoices: function () {
    return this.get('contentType.controls').rejectBy('name', 'name').rejectBy('name', 'preview_url').rejectBy('name', 'instruction');
  }.property('contentType.controls.@each'),

  cmsControls: function () {
    var controls = this.get('contentType.controls').filterBy('showInCms');
    controls.forEach(function (control) {
      control.set('isSortable', control.get('controlType.valueType') === 'string');
    });
    return controls;
  }.property('contentType.controls.@each.showInCms'),

  _updateItemControls: function (item) {
    var cmsControls = Ember.A([]);
    this.get('cmsControls').forEach(function (control) {
      cmsControls.pushObject({
        value: item.get('itemData')[control.get('name')],
        controlType: control.get('controlType'),
        control: control
      });
    });
    item.set('cmsControls', cmsControls);
    return item;
  },

  cmsItems: Ember.arrayComputed('content.@each.itemData', 'cmsControls.@each.showInCms', {
    addedItem: function (array, item, changeMeta) {

      if (item.constructor.typeKey === 'control') {
        array.forEach(this._updateItemControls.bind(this));
      } else {
        array.pushObject(this._updateItemControls(item));
      }

      return array;
    },
    removedItem: function (array, item) {
      if (item.constructor.typeKey !== 'control') {
        array.removeObject(item);
      }
      return array;
    }
  }),

  locksChanged: function () {
    this.get('cmsItems').setEach('lockedBy', null);
    this.get('lockedItems').forEach(function (lock) {
      var item = this.get('cmsItems').findBy('id', lock.get('id'));
      // locked item isn't necessarily on the same page as what you are looking at
      if (item) {
        item.set('lockedBy', lock.get('email'));
      }
    }, this);
  }.observes('lockedItems.@each'),

  refreshContent: function () {
    this.set('isLoading', true);
    this.set('isSearchResults', false);
    this.set('content', Ember.A([]));
    this.set('endReached', false);

    var controller = this;
    this.store.find(this.get('itemModelName'), {
      limit: this.get('recordLimit'),
      orderBy: this.get('sortProperties.firstObject').replace('itemData.', ''),
      desc: !this.get('sortAscending')
    }).then(function (records) {
      controller.set('endReached', records.get('length') < controller.get('recordLimit'));
      controller.set('isLoading', false);
      controller.set('content', records);
    });
  },

  searchPlaceholder: function () {
    return 'Search ' + this.get('contentType.name');
  }.property('contentType'),

  debouncedSearchQueryObserver: Ember.debouncedObserver(function() {

    if (!this.get('searchQuery')) {
      this.refreshContent();
      return;
    }

    this.set('isLoading', true);
    this.set('isSearchResults', true);
    this.set('content', Ember.A([]));

    this.get('cmsControls').setEach('isSortAscending', false);
    this.get('cmsControls').setEach('isSortDescending', false);

    var controller = this;

    var pushResults = function (results) {

      var records = results.getEach('id').map(function (recordId) {
        return controller.store.find(controller.get('itemModelName'), recordId);
      });

      Ember.RSVP.allSettled(records).then(function (settled) {

        controller.set('isLoading', false);

        var records = settled.rejectBy('state', 'rejected').map(function (query) {
          return query.value;
        });

        controller.get('content').pushObjects(records);

      });
    };

    var searchQuery = this.get('searchQuery');
    var contentTypeId = this.get('contentType.id');

    SearchIndex.search(searchQuery, 1, contentTypeId).then(pushResults);

  }, 'searchQuery', 500),

  actions: {

    toggleShowInCms: function (control) {
      control.toggleProperty('showInCms');
      this.get('contentType').save();
    },

    sortToggle: function (control) {

      this.get('cmsControls').setEach('isSortAscending', false);
      this.get('cmsControls').setEach('isSortDescending', false);

      var orderBy = control.get('name');

      if (control.get('controlType.widget') === 'datetime') {
        orderBy = '_sort_' + control.get('name');
      }

      var sortProperties = this.get('sortProperties');

      if (sortProperties.get('firstObject').replace('itemData.', '') === orderBy) {
        this.toggleProperty('sortAscending');
      } else {
        this.set('sortAscending', true);
      }

      // this.set('orderBy', orderBy);
      sortProperties.insertAt(0, 'itemData.' + orderBy);
      this.set('sortProperties', sortProperties.uniq());

      control.set('isSortAscending', this.get('sortAscending'));
      control.set('isSortDescending', !this.get('sortAscending'));

      if (this.get('isSearchResults')) {
        var sortedContent = this.get('content').sortBy(this.get('sortProperties.firstObject'));
        if (!this.get('sortAscending')) {
          sortedContent.reverse();
        }
        this.set('content', sortedContent);
      } else {
        this.refreshContent();
      }

    },

    gotoEdit: function (contentTypeId, itemId) {
      this.transitionToRoute('wh.content.type.edit', contentTypeId, itemId);
    },

    moreRecords: function () {

      this.set('isLoading', true);

      var controller = this;

      var query = {
        limit: this.get('recordLimit') + 1,
        orderBy: this.get('sortProperties.firstObject').replace('itemData.', ''),
        desc: !this.get('sortAscending')
      };

      var lastValue = this.get('content.lastObject').get(this.get('sortProperties.firstObject'));

      if (this.get('sortAscending')) {
        query.startAt = lastValue;
      } else {
        query.endAt = lastValue;
      }

      this.store.find(this.get('itemModelName'), query).then(function (records) {
        controller.set('endReached', records.get('length') - 1 < controller.get('recordLimit'));
        controller.set('isLoading', false);
        controller.get('content').addObjects(records);
      });

    },

    unlockItem: function (item) {
      if (!window.confirm('Are you sure you want to unlock this item?')) {
        return;
      }
      this.get('lockedRef').child(item.get('id')).remove();
    }
  }

});
