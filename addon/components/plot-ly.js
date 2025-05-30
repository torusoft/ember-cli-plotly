import Component from '@ember/component';
import EmberObject, { computed } from '@ember/object';
import Ember from 'ember';
import { observes } from '@ember-decorators/object';
import { debounce, scheduleOnce, next } from '@ember/runloop';
import { buildWaiter } from '@ember/test-waiters';
const waiter = buildWaiter('ember-cli-plotly:component-loaded');

import layout from '../templates/components/plot-ly';

import PromiseProxyMixin from '@ember/object/promise-proxy-mixin';
import ObjectProxy from '@ember/object/proxy';

import debug from 'debug';

const log = debug('ember-cli-plotly:plot-ly-component');
const warn = debug('ember-cli-plotly:plot-ly-component');
/* eslint-disable no-console */
warn.log = console.warn.bind(console);
/* eslint-enable no-console */

const ObjectPromiseProxy = ObjectProxy.extend(PromiseProxyMixin);

// TODO: Make configurable via ENV
// https://github.com/plotly/plotly.js/blob/5bc25b490702e5ed61265207833dbd58e8ab27f1/src/plot_api/plot_config.js#L22-L184
const defaultConfig = {
  staticPlot: false,
  editable: true,
  edits: {
    annotationPosition: false,
    annotationTail: false,
    annotationText: false,
    axisTitleText: false,
    colorbarPosition: false,
    colorbarTitleText: false,
    legendPosition: false,
    legendText: false,
    shapePosition: false,
    titleText: false
  },
  autosizable: false,
  queueLength: 0,
  fillFrame: false,
  frameMargins: 0,
  scrollZoom: false,
  doubleClick: 'reset+autosize',
  showTips: false,
  showAxisDragHandles: true,
  showAxisRangeEntryBoxes: true,
  showLink: false,
  sendData: true,
  linkText: 'Edit chart',
  showSources: false,
  displayModeBar: 'hover',
  modeBarButtonsToRemove: ['sendDataToCloud'],
  modeBarButtonsToAdd: [],
  modeBarButtons: false,
  displaylogo: true,
  plotGlPixelRatio: 2,
  setBackground: 'transparent',
  topojsonURL: 'https://cdn.plot.ly/',
  mapboxAccessToken: null,
  globalTransforms: [],
  locale: 'en-US',
};

const knownPlotlyEvents = [
  'afterplot',
  'animated',
  'autosize',
  'click',
  'deselect',
  'doubleclick',
  'hover',
  'legendclick',
  'legenddoubleclick',
  'redraw',
  'relayout',
  'restyle',
  'selected',
  'selecting',
  'unhover',
].map(suffix => `plotly_${suffix}`);

export default class PlotlyComponent extends Component {
  constructor(...args) {
    super(...args);

    /* global Ember */
    let token;
    if (Ember.testing) {
      token = waiter.beginAsync();
    }

    const promise = import('plotly.js/dist/plotly').then(module => module.default);
    // import('plotly.js') does not work?
    this.set('_plotly', ObjectPromiseProxy.create({
      promise,
    }));

    if (Ember.testing) {
      promise.finally(() => { waiter.endAsync(token); })
    }

    this.set('layout', layout);
    this._logUnrecognizedPlotlyEvents();
  }

  // Consumers should override this if they want to handle plotly_events
  onPlotlyEvent(eventName, ...args) {
    log('onPlotlyEvent fired (does nothing since it was not overridden)', eventName, ...args);
  }

  onNewPlot(plotlyRef, ...args) {

  }

  // Lifecycle hooks
  didInsertElement() {
    log('didInsertElement called -- will call _newPlot');
    scheduleOnce('render', this, '_newPlot');
  }

  didUpdate() {
    log('didUpdate called -- will call _react', this);
    scheduleOnce('render', this, '_react');
  }

  willDestroyElement() {
    log('willDestroyElement called -- unbinding event listeners and calling Plotly.purge');
    this._unbindPlotlyEventListeners();

    if (this._plotly.isFulfilled) {
      this._plotly.content.purge(this.elementId);
    }
  }


  // Private
  // eslint-disable-next-line ember/no-observers
  @observes('plotlyEvents.[]')
  _logUnrecognizedPlotlyEvents() {
    const plotlyEvents = this.plotlyEvents;
    if (plotlyEvents && typeof plotlyEvents.forEach === 'function') {
      plotlyEvents.forEach(eventName => {
        if (!knownPlotlyEvents.find(name => name === eventName)) {
          warn(`Passing unrecognized plotly event: '${eventName}'`);
        }
      });
    }
    else {
      log(`plotlyEvents does not appear to be an array`, plotlyEvents);
    }
  }

  // eslint-disable-next-line ember/no-observers
  @observes('chartData.triggerUpdate')
  _triggerUpdate() {
    log(`_triggerUpdate observer firing`);
    next(this, this._react);
  }


  // Merge user-provided parameters with defaults
  @computed('chartConfig', 'chartData', 'chartLayout', 'elementId', 'isResponsive', 'plotlyEvents')
  get _parameters() {
    const parameters = Object.assign({}, {
      chartData: this.chartData,
      chartLayout: this.chartLayout || document.getElementById(this.elementId).layout || EmberObject.create({ datarevision: 0 }),
      chartConfig: Object.assign(defaultConfig, this.chartConfig),
      isResponsive: !!this.isResponsive,
      plotlyEvents: this.plotlyEvents || []
    });
    log(`computing parameters =`, parameters);
    return parameters;
  }

  // TODO: Make throttling/debouncing/whatever more flexible/configurable
  _resizeEventHandler() {
    log('_resizeEventHandler');
    try {
      debounce(this, this._debouncedResizeEventHandler, 200);
    }
    catch (e) {
      warn(`_resizeEventHandler caught exception when calling debounce (not sure why this happens)`, e);
    }
  }

  _debouncedResizeEventHandler() {
    log('_debouncedResizeEventHandler firing (scheduling _onResize to run after next render)');
    scheduleOnce('afterRender', this, this._onResize);
  }

  _onResize() {
    log('_onResize firing');
    this._plotly.then(Plotly => Plotly.Plots.resize(this.elementId));
  }

  _boundResizeEventHandler() {} // overwritten in _bindPlotlyEventListeners

  _bindPlotlyEventListeners() {
    if (this._parameters.isResponsive) {
      this.set('_boundResizeEventHandler', this._resizeEventHandler.bind(this));
      window.addEventListener('resize', this._boundResizeEventHandler);
    }

    const plotlyEvents = (this.plotlyEvents === undefined ? [] : this.plotlyEvents);
    log('_bindPlotlyEventListeners', plotlyEvents, this.element);
    plotlyEvents.forEach((eventName) => {
      // Note: Using plotly.js' 'on' method (copied from EventEmitter)
      this.element.on(eventName, (...args) => this.onPlotlyEvent(eventName, ...args));
    });
  }

  _unbindPlotlyEventListeners() {
    window.removeEventListener('resize', this._boundResizeEventHandler);
    const events = (this.plotlyEvents === undefined ? [] : this.plotlyEvents);
    log('_unbindPlotlyEventListeners', events, this.element);
    events.forEach((eventName) => {
      // Note: Using plotly.js' 'removeListener' method (copied from EventEmitter)
      if (typeof this.element.removeListener === 'function') {
        this.element.removeListener(eventName, this.onPlotlyEvent);
      }
    });
  }

  _isDomElementBad() {
    return !this.element || !this.elementId || this.isDestroying || this.isDestroyed;
  }

  _newPlot() {
    this._plotly.then(Plotly => {
      if (this._isDomElementBad()) {
        warn(`_newPlot aborting since element (or its ID) is not available or component is (being) destroyed.`);
        return;
      }
      const id = this.elementId;
      const { chartData, chartLayout, chartConfig } = this._parameters;
      this._unbindPlotlyEventListeners();
      log('About to call Plotly.newPlot');
      let self = this;
      Plotly.newPlot(id, chartData, chartLayout, chartConfig).then(() => {
        log('newPlot finished');
        this._bindPlotlyEventListeners();
        this.onNewPlot(self);
        // TODO: Hook
      }).catch((e, ...args) => {
        warn(`Plotly.newPlot resulted in rejected promise`, e, ...args);
      });
    });
  }

  _react() {
    this._plotly.then(Plotly => {
      if (this._isDomElementBad()) {
        warn(`_react aborting since element (or its ID) is not available or component is (being) destroyed.`);
        return;
      }
      const id = this.elementId;
      const { chartData, chartLayout, chartConfig } = this._parameters;
      // Force update
      chartLayout.datarevision += 1;
      log('About to call Plotly.react', chartData, chartLayout, chartConfig);
      Plotly.react(id, chartData, chartLayout, chartConfig).then(() => {
        log('react finished');
      }).catch((e, ...args) => {
        warn(`Plotly.react resulted in rejected promise`, e, ...args);
      });
    });
  }
}
